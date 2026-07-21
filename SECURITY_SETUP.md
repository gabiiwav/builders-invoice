# Production security setup

The application requires these Vercel environment variables:

- `APP_ORIGIN=https://www.buildersinvoice.com`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_BUSINESS_PRICE_ID`

Apply `supabase/migrations/202607200001_security_hardening.sql` to a staging project first. The migration intentionally replaces existing policies on the application tables because PostgreSQL combines permissive policies with `OR`.

Configure Supabase Auth's site URL and redirect allowlist to include:

- `https://www.buildersinvoice.com/app.html`
- local or preview URLs used during development

Configure Stripe to send the relevant Checkout and subscription events to `/api/stripe-webhook`. The endpoint intentionally rejects every request when `STRIPE_WEBHOOK_SECRET` is absent.

Do not expose `SUPABASE_SERVICE_KEY` or `STRIPE_SECRET_KEY` in browser code. The Supabase publishable key in `app.html` is expected to be public and relies on row-level security.
