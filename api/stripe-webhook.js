// /api/stripe-webhook.js
// Handles BOTH:
//   1. Invoice payments (Stripe Connect — marks invoices as Paid)
//   2. Subscription events (tier upgrades/downgrades/cancellations)

const Stripe = require('stripe');
const { getServiceClient } = require('../lib/server-auth');
const { getTierFromPrice, updateProfile } = require('../lib/stripe-subscriptions');

async function findUserByCustomer(supabase, customerId) {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();
  return data?.id || null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const webhookSecrets = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  ].filter(Boolean);
  if (webhookSecrets.length === 0) {
    console.error('Stripe webhook rejected: no webhook secret is configured');
    return res.status(500).json({ error: 'Webhook is not configured' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = getServiceClient();

  // Signature verification is mandatory. Never accept caller-provided event JSON.
  let event;
  const sig = req.headers['stripe-signature'];
  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const rawBody = Buffer.concat(chunks);
    for (const secret of webhookSecrets) {
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, secret);
        break;
      } catch (verificationError) {
        // Try the next configured endpoint secret.
      }
    }
    if (!event) throw new Error('No configured Stripe webhook secret matched');
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;

        // Invoice payment: direct charge owned by the connected account.
        const invoiceId = session.metadata?.invoice_id;
        if (invoiceId) {
          const attemptId = session.metadata?.payment_attempt_id;
          if (!attemptId || !event.account) {
            throw new Error('Invoice payment metadata is incomplete');
          }
          const metadataAmount = Number(session.metadata?.expected_amount_cents);
          if (
            session.payment_status !== 'paid' ||
            session.amount_total !== metadataAmount
          ) {
            throw new Error('Invoice payment verification failed');
          }

          const paymentIntent = await stripe.paymentIntents.retrieve(
            session.payment_intent,
            { stripeAccount: event.account },
          );
          const chargeId = typeof paymentIntent.latest_charge === 'string'
            ? paymentIntent.latest_charge
            : paymentIntent.latest_charge?.id;

          const { error: completeError } = await supabase.rpc('complete_invoice_payment', {
            attempt_id: attemptId,
            session_id: session.id,
            connected_account_id: event.account,
            paid_amount_cents: session.amount_total,
            payment_intent: session.payment_intent,
            charge: chargeId || null,
          });
          if (completeError) throw completeError;
        }

        // Subscription purchase (tier upgrade)
        if (session.mode === 'subscription' && session.client_reference_id) {
          const userId = session.client_reference_id;
          const customerId = session.customer;
          const subscriptionId = session.subscription;

          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = subscription.items.data[0]?.price?.id;
          const tier = getTierFromPrice(priceId);

          if (tier) {
            // Cancel any existing subscription to prevent duplicates
            const { data: existing } = await supabase
              .from('profiles')
              .select('stripe_subscription_id')
              .eq('id', userId)
              .single();

            if (existing?.stripe_subscription_id && existing.stripe_subscription_id !== subscriptionId) {
              try {
                await stripe.subscriptions.cancel(existing.stripe_subscription_id);
              } catch (e) { /* old sub may already be cancelled */ }
            }

            await updateProfile(supabase, userId, {
              subscription_tier: tier,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              updated_at: new Date().toISOString(),
            });
          }
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        if (!event.account || !charge.amount_refunded) break;
        const { error: refundError } = await supabase.rpc('record_invoice_refund', {
          refunded_charge_id: charge.id,
          connected_account_id: event.account,
          refund_amount_cents: charge.amount_refunded,
          fully_refunded: Boolean(charge.refunded),
        });
        if (refundError) throw refundError;
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        if (subscription.status === 'active' || subscription.status === 'trialing') {
          const userId = await findUserByCustomer(supabase, subscription.customer);
          if (!userId) break;

          const priceId = subscription.items.data[0]?.price?.id;
          const tier = getTierFromPrice(priceId);
          if (tier) {
            await updateProfile(supabase, userId, {
              subscription_tier: tier,
              stripe_subscription_id: subscription.id,
              updated_at: new Date().toISOString(),
            });
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = await findUserByCustomer(supabase, subscription.customer);
        if (userId) {
          await updateProfile(supabase, userId, {
            subscription_tier: 'free',
            stripe_subscription_id: null,
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }

      case 'invoice.payment_failed':
        // Stripe retries automatically — no action needed
        break;

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    // Non-2xx tells Stripe to retry transient processing failures.
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports.config = {
  api: { bodyParser: false },
};
