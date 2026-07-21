# Deployment

## Pre-deployment

1. Run `npm ci`.
2. Run `npm run check`.
3. Run `npm run audit`.
4. Back up the Supabase database.
5. Apply pending migrations in order.
6. Confirm all server environment variables in `SECURITY_SETUP.md`.
7. Optionally set `VITE_SENTRY_DSN` to enable error reporting without default PII collection.

## Vercel

Vite builds both `index.html` and `app.html`. The `api/` directory remains the Vercel serverless boundary. Deploy from the protected main branch after database migrations succeed.

## Smoke checks

- Sign up, log in, log out, and complete password recovery.
- Create and edit a quote with multiple line-item types.
- Convert the quote to an invoice.
- Create a Stripe Checkout link and complete a test payment.
- Confirm the signed webhook marks only the matching invoice paid.
- Add an expense and verify P&L counts only paid invoices.
- Open a shared quote/invoice UUID in a logged-out browser.
