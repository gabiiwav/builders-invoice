# Payments

## Invoice payments

1. An authenticated contractor requests checkout for an invoice ID.
2. The server loads the invoice total and contractor Stripe account from Supabase.
3. Stripe Checkout is created directly on the contractor's Standard connected account.
4. The signed webhook verifies payment status, amount, invoice owner, and metadata.
5. Only then is the invoice marked `Paid`.

Builders Invoice does not receive or transfer invoice funds and takes no
application fee. The contractor's Stripe account owns the charge and handles
Stripe processing fees, refunds, disputes, chargebacks, and payouts.

## Payment safety

- Emails contain a permanent `/api/invoice-payment` URL, not an expiring Stripe
  Checkout URL.
- Opening that URL reuses the one active Checkout Session for the current
  invoice version or safely creates a new one after expiration.
- A partial unique index permits only one creating/open payment attempt per
  invoice.
- Stripe Session creation uses an idempotency key unique to the database
  payment attempt.
- Invoice financial fields are locked while a Checkout Session is active.
- Webhook settlement is atomic and verifies the attempt, connected account,
  amount, Session, and invoice version.
- `GET /api/stripe-reconcile` independently repairs missed webhook processing.
  It requires `Authorization: Bearer $CRON_SECRET` and should run regularly.
- Contractors issue refunds in their own Stripe Dashboard. The connected
  `charge.refunded` event marks the Builders Invoice record as `Refunded`.

## Subscriptions

The browser sends a tier name. The server maps that tier to an environment-configured Stripe price and derives the user from the verified Supabase token. Subscription state is updated only by signed Stripe webhooks.

## Required platform webhook events

- `checkout.session.completed` for Builders Invoice subscription purchases
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

## Required connected-account webhook events

- `checkout.session.completed`
- `charge.refunded`

Platform and connected-account endpoints have separate signing secrets even
when both use `/api/stripe-webhook`. Verification fails closed when no signing
secret is configured. Processing failures return a non-2xx response so Stripe
retries them.
