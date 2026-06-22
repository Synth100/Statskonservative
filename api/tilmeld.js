import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const MAX_BODY_BYTES = 20 * 1024;
const RATE_LIMIT_ATTEMPTS = 3;
const RATE_LIMIT_WINDOW_MINUTES = 30;

const ALLOWED_INTEREST_AREAS = new Set([
  "",
  "membership",
  "newsletter",
  "volunteering",
  "local-branch",
  "general"
]);

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
  if (email.length < 6 || email.length > 150) return false;

  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(email);
}

function isValidPostcode(postcode) {
  return postcode === "" || /^\d{4}$/.test(postcode);
}

function getClientIp(request) {
  const forwardedFor = request.headers["x-forwarded-for"];
  const realIp = request.headers["x-real-ip"];
  const vercelForwardedFor = request.headers["x-vercel-forwarded-for"];

  const raw =
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) ||
    (Array.isArray(vercelForwardedFor) ? vercelForwardedFor[0] : vercelForwardedFor) ||
    (Array.isArray(realIp) ? realIp[0] : realIp) ||
    request.socket?.remoteAddress ||
    "unknown";

  return String(raw).split(",")[0].trim() || "unknown";
}

function hashIdentifier(value, secret) {
  return crypto
    .createHash("sha256")
    .update(`${secret}:${value}`)
    .digest("hex");
}

function getWindowStart(date = new Date()) {
  const windowMs = RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;
  const windowStart = Math.floor(date.getTime() / windowMs) * windowMs;

  return new Date(windowStart);
}

async function getBody(request) {
  const contentLength = Number(request.headers["content-length"] || 0);

  if (contentLength > MAX_BODY_BYTES) {
    const error = new Error("Request body is too large.");
    error.statusCode = 413;
    throw error;
  }

  if (request.body) {
    if (typeof request.body === "string") {
      if (Buffer.byteLength(request.body, "utf8") > MAX_BODY_BYTES) {
        const error = new Error("Request body is too large.");
        error.statusCode = 413;
        throw error;
      }

      return JSON.parse(request.body || "{}");
    }

    return request.body;
  }

  return await new Promise((resolve, reject) => {
    let rawBody = "";
    let totalBytes = 0;

    request.on("data", function(chunk) {
      totalBytes += chunk.length;

      if (totalBytes > MAX_BODY_BYTES) {
        const error = new Error("Request body is too large.");
        error.statusCode = 413;
        reject(error);
        request.destroy();
        return;
      }

      rawBody += chunk;
    });

    request.on("end", function() {
      try {
        resolve(JSON.parse(rawBody || "{}"));
      } catch (error) {
        error.statusCode = 400;
        reject(error);
      }
    });

    request.on("error", function(error) {
      reject(error);
    });
  });
}

async function checkRateLimit({ supabase, scope, identifierHash }) {
  const windowStart = getWindowStart().toISOString();

  const { data, error } = await supabase.rpc("record_signup_attempt", {
    p_scope: scope,
    p_identifier_hash: identifierHash,
    p_window_start: windowStart,
    p_max_attempts: RATE_LIMIT_ATTEMPTS
  });

  if (error) {
    console.error("Rate limit check failed:", error);
    return {
      allowed: false,
      statusCode: 503,
      message: "Tilmeldingen kan ikke behandles lige nu. Prøv igen om lidt."
    };
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result?.allowed) {
    return {
      allowed: false,
      statusCode: 429,
      message: "Der er sendt for mange tilmeldinger fra samme forbindelse. Prøv igen om cirka 30 minutter."
    };
  }

  return { allowed: true };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, {
      ok: false,
      message: "Denne handling er ikke tilladt."
    });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const rateLimitSecret = process.env.RATE_LIMIT_SECRET || supabaseKey;

    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing Supabase server configuration.");
      return sendJson(response, 500, {
        ok: false,
        message: "Serveren mangler konfiguration."
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const body = await getBody(request);
    const botField = normalizeText(body.botField, 200);

    if (botField) {
      return sendJson(response, 200, {
        ok: true,
        message: "Tak. Din tilmelding er modtaget."
      });
    }

    const clientIp = getClientIp(request);
    const ipHash = hashIdentifier(clientIp, rateLimitSecret);
    const rateLimit = await checkRateLimit({
      supabase,
      scope: "signup_ip",
      identifierHash: ipHash
    });

    if (!rateLimit.allowed) {
      return sendJson(response, rateLimit.statusCode, {
        ok: false,
        message: rateLimit.message
      });
    }

    const firstName = normalizeText(body.firstName, 80);
    const lastName = normalizeText(body.lastName, 80);
    const email = normalizeText(body.email, 150).toLowerCase();
    const postcode = normalizeText(body.postcode, 4);
    const interestArea = normalizeText(body.interestArea || body.interest, 80);
    const sourcePage = normalizeText(body.sourcePage, 80) || "statskonservative-homepage";
    const userAgent = normalizeText(request.headers["user-agent"], 300);
    const consent = body.consent === true || body.consent === "true" || body.consent === "on";

    if (firstName.length < 2) {
      return sendJson(response, 400, {
        ok: false,
        message: "Skriv et fornavn på mindst 2 tegn."
      });
    }

    if (lastName.length < 2) {
      return sendJson(response, 400, {
        ok: false,
        message: "Skriv et efternavn på mindst 2 tegn."
      });
    }

    if (!isValidEmail(email)) {
      return sendJson(response, 400, {
        ok: false,
        message: "Skriv en gyldig e-mailadresse."
      });
    }

    if (!isValidPostcode(postcode)) {
      return sendJson(response, 400, {
        ok: false,
        message: "Postnummer skal være præcis 4 cifre."
      });
    }

    if (!ALLOWED_INTEREST_AREAS.has(interestArea)) {
      return sendJson(response, 400, {
        ok: false,
        message: "Vælg et gyldigt interesseområde."
      });
    }

    if (!consent) {
      return sendJson(response, 400, {
        ok: false,
        message: "Du skal give samtykke, før formularen kan sendes."
      });
    }

    const emailHash = hashIdentifier(email, rateLimitSecret);
    const emailRateLimit = await checkRateLimit({
      supabase,
      scope: "signup_email",
      identifierHash: emailHash
    });

    if (!emailRateLimit.allowed) {
      return sendJson(response, emailRateLimit.statusCode, {
        ok: false,
        message: emailRateLimit.message
      });
    }

    const consentText =
      "Jeg giver udtrykkeligt samtykke til, at Statskonservative må behandle mine oplysninger for at kontakte mig om medlemskab, nyheder, aktiviteter og lokal opbygning. Jeg er informeret om, at min tilmelding kan afsløre politisk interesse, og at jeg til enhver tid kan trække mit samtykke tilbage ved at skrive til kontakt@statskonservative.dk. Jeg har læst privatlivspolitikken.";

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
        return sendJson(response, 200, {
          ok: true,
          message: "Tak. Hvis e-mailadressen kan tilmeldes, bliver den registreret."
        });
      }

      console.error("Supabase insert error:", error);

      return sendJson(response, 500, {
        ok: false,
        message: "Serveren kunne ikke gemme tilmeldingen lige nu. Prøv igen om lidt."
      });
    }

    return sendJson(response, 200, {
      ok: true,
      message: `Tak, ${firstName}. Din tilmelding er blevet gemt.`
    });
  } catch (error) {
    console.error("Unexpected server error:", error);

    const statusCode = error.statusCode || 500;
    const message =
      statusCode === 400
        ? "Ugyldig forespørgsel."
        : statusCode === 413
          ? "Forespørgslen er for stor."
          : "Der opstod en serverfejl. Prøv igen om lidt.";

    return sendJson(response, statusCode, {
      ok: false,
      message
    });
  }
}
