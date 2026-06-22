# Statskonservative security notes

## Before deploying

1. Rotate the Supabase secret/service key if `.env.local` has ever been shared, uploaded, or committed.
2. Add these environment variables in Vercel, not in frontend files:
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
   - `RATE_LIMIT_SECRET`
3. Run `supabase.sql` in Supabase SQL editor before using the signup form.
4. Do not upload or share these folders/files:
   - `.env`
   - `.env.local`
   - `.env.*`
   - `.git`
   - `.vercel`
   - `node_modules`

## What has been hardened

- Signup submissions go through `/api/tilmeld`, not directly from browser to Supabase.
- Backend validates name, email, postcode, interest area and consent.
- Postcode must be empty or exactly 4 digits.
- Interest area is restricted to known values.
- API responses no longer expose internal database errors.
- Request body size is limited.
- Rate limiting is stored in Supabase using hashed identifiers.
- Vercel security headers include CSP, frame protection and HSTS.

## Still recommended later

- Add double opt-in email confirmation before treating a signup as fully confirmed.
- Add Turnstile/CAPTCHA if the form still receives automated spam.
- Review stored signups at least once per year and delete data that is no longer needed.
