# Production security setup

The application requires these Vercel environment variables:

- `APP_ORIGIN=https://www.buildersinvoice.com`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CONNECT_WEBHOOK_SECRET`
- `STRIPE_CONNECT_CLIENT_ID`
- `STRIPE_CONNECT_STATE_SECRET`
- `CRON_SECRET`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_BUSINESS_PRICE_ID`

Apply `supabase/migrations/202607200001_security_hardening.sql` to a staging project first. The migration intentionally replaces existing policies on the application tables because PostgreSQL combines permissive policies with `OR`.

Configure Supabase Auth's site URL and redirect allowlist to include:

- `https://www.buildersinvoice.com/app.html`
- local or preview URLs used during development

Configure a platform webhook for subscription events and a Connect webhook for
events on connected accounts. Both point to `/api/stripe-webhook`. Store their
separate signing secrets in `STRIPE_WEBHOOK_SECRET` and
`STRIPE_CONNECT_WEBHOOK_SECRET`.

Register `https://www.buildersinvoice.com/api/stripe-connect-callback` as the
live Stripe Connect OAuth redirect URI. `STRIPE_CONNECT_CLIENT_ID` is the
platform's live Connect client ID. Use a unique, high-entropy
`STRIPE_CONNECT_STATE_SECRET` to protect the OAuth callback.

Schedule an authenticated request to `/api/stripe-reconcile` at least every
15 minutes with `Authorization: Bearer $CRON_SECRET`. This is an independent
recovery path when a Stripe webhook is delayed or temporarily fails.

Apply `supabase/migrations/202607240001_payment_safety.sql` before enabling
invoice card payments. It creates the authoritative payment-attempt ledger,
prevents concurrent Checkout Sessions, locks invoice amounts during payment,
and provides atomic settlement/refund functions.

Do not expose `SUPABASE_SERVICE_KEY` or `STRIPE_SECRET_KEY` in browser code. The Supabase publishable key in `app.html` is expected to be public and relies on row-level security.
