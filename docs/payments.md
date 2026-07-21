# Payments

## Invoice payments

1. An authenticated contractor requests checkout for an invoice ID.
2. The server loads the invoice total and contractor Stripe account from Supabase.
3. Stripe Checkout receives the trusted amount and destination.
4. The signed webhook verifies payment status, amount, invoice owner, and metadata.
5. Only then is the invoice marked `Paid`.

## Subscriptions

The browser sends a tier name. The server maps that tier to an environment-configured Stripe price and derives the user from the verified Supabase token. Subscription state is updated only by signed Stripe webhooks.

## Required webhook events

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

Webhook verification fails closed when `STRIPE_WEBHOOK_SECRET` is absent. Processing failures return a non-2xx response so Stripe retries them.
