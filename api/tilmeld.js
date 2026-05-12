import { createClient } from "@supabase/supabase-js";

function sendJson(response, statusCode, data) {
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify(data));
}

function normalizeText(value, maxLength = 200) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, maxLength);
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function getBody(request) {
    if (request.body) {
        if (typeof request.body === "string") {
            return JSON.parse(request.body || "{}");
        }

        return request.body;
    }

    return await new Promise((resolve, reject) => {
        let rawBody = "";

        request.on("data", function(chunk) {
            rawBody += chunk;
        });

        request.on("end", function() {
            try {
                resolve(JSON.parse(rawBody || "{}"));
            } catch (error) {
                reject(error);
            }
        });

        request.on("error", function(error) {
            reject(error);
        });
    });
}

export default async function handler(request, response) {
    if (request.method !== "POST") {
        return sendJson(response, 405, {
            ok: false,
            message: "Method not allowed."
        });
    }

    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseKey) {
            return sendJson(response, 500, {
                ok: false,
                message: "Server configuration is missing."
            });
        }

        const body = await getBody(request);

        const botField = normalizeText(body.botField, 200);

        if (botField) {
            return sendJson(response, 200, {
                ok: true,
                message: "Thank you. Your signup has been received."
            });
        }

        const firstName = normalizeText(body.firstName, 80);
        const lastName = normalizeText(body.lastName, 80);
        const email = normalizeText(body.email, 150).toLowerCase();
        const postcode = normalizeText(body.postcode, 20);
        const interestArea = normalizeText(body.interestArea || body.interest, 80);
        const sourcePage = normalizeText(body.sourcePage, 80) || "homepage";
        const userAgent = normalizeText(request.headers["user-agent"], 300);
        const consent = body.consent === true || body.consent === "true" || body.consent === "on";

        if (firstName.length < 2) {
            return sendJson(response, 400, {
                ok: false,
                message: "First name must be at least 2 characters."
            });
        }

        if (lastName.length < 2) {
            return sendJson(response, 400, {
                ok: false,
                message: "Last name must be at least 2 characters."
            });
        }

        if (!isValidEmail(email)) {
            return sendJson(response, 400, {
                ok: false,
                message: "Please provide a valid email address."
            });
        }

        if (!consent) {
            return sendJson(response, 400, {
                ok: false,
                message: "Consent is required."
            });
        }

        const supabase = createClient(supabaseUrl, supabaseKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });

        const consentText =
            "I consent to being contacted by Statskonservative about membership, activities, and related information.";

        const payload = {
            first_name: firstName,
            last_name: lastName,
            email: email,
            postcode: postcode || null,
            interest_area: interestArea || null,
            consent: true,
            consent_text: consentText,
            source_page: sourcePage,
            user_agent: userAgent || null
        };

        const { error } = await supabase
            .from("signups")
            .insert(payload);

        if (error) {
            if (error.code === "23505") {
                return sendJson(response, 409, {
                    ok: false,
                    message: "This email address is already registered."
                });
            }

            console.error("Supabase insert error:", error);

            return sendJson(response, 500, {
                ok: false,
                message: "The server could not save your signup right now.",
                details: error.message
            });
        }

        return sendJson(response, 200, {
            ok: true,
            message: `Thank you, ${firstName}. Your signup has been saved.`
        });
    } catch (error) {
        console.error("Unexpected server error:", error);

        return sendJson(response, 500, {
            ok: false,
            message: "Unexpected server error.",
            details: error.message
        });
    }
}