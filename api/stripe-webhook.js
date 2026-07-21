// /api/stripe-webhook.js
// Handles BOTH:
//   1. Invoice payments (Stripe Connect — marks invoices as Paid)
//   2. Subscription events (tier upgrades/downgrades/cancellations)

const Stripe = require('stripe');
const { getServiceClient } = require('../lib/server-auth');

function getTierFromPrice(priceId) {
  const PRICES = {
    'price_1TKNZ4BimZ1XIzKT4QgWeblP': 'pro',
    'price_1TKNZTBimZ1XIzKTu62QITm9': 'business',
  };
  return PRICES[priceId] || null;
}

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

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('Stripe webhook rejected: STRIPE_WEBHOOK_SECRET is not configured');
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
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;

        // Invoice payment (Stripe Connect)
        const invoiceId = session.metadata?.invoice_id;
        if (invoiceId) {
          const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .select('id, user_id, total')
            .eq('id', invoiceId)
            .single();
          if (invoiceError || !invoice) throw new Error('Paid invoice was not found');

          const expectedAmount = Math.round(Number(invoice.total) * 100);
          const metadataAmount = Number(session.metadata?.expected_amount_cents);
          if (
            session.payment_status !== 'paid' ||
            session.amount_total !== expectedAmount ||
            metadataAmount !== expectedAmount ||
            session.metadata?.user_id !== invoice.user_id
          ) {
            throw new Error('Invoice payment verification failed');
          }

          const { error: updateError } = await supabase
            .from('invoices')
            .update({ status: 'Paid' })
            .eq('id', invoiceId)
            .eq('user_id', invoice.user_id);
          if (updateError) throw updateError;
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

            await supabase.from('profiles').update({
              subscription_tier: tier,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              updated_at: new Date().toISOString(),
            }).eq('id', userId);
          }
        }
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
            await supabase.from('profiles').update({
              subscription_tier: tier,
              stripe_subscription_id: subscription.id,
              updated_at: new Date().toISOString(),
            }).eq('id', userId);
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = await findUserByCustomer(supabase, subscription.customer);
        if (userId) {
          await supabase.from('profiles').update({
            subscription_tier: 'free',
            stripe_subscription_id: null,
            updated_at: new Date().toISOString(),
          }).eq('id', userId);
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
