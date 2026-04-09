// /api/stripe-webhook.js
// Handles BOTH:
//   1. Invoice payments (Stripe Connect — marks invoices as Paid)
//   2. Subscription events (tier upgrades/downgrades/cancellations)
//
// ENV VARS NEEDED:
//   STRIPE_SECRET_KEY       — sk_test_xxx or sk_live_xxx
//   STRIPE_WEBHOOK_SECRET   — whsec_xxx from Stripe webhook settings
//   SUPABASE_SERVICE_KEY    — Supabase service_role key
//   STRIPE_PRICE_PRO        — price_xxx for Pro plan
//   STRIPE_PRICE_BUSINESS   — price_xxx for Business plan

const Stripe = require('stripe');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tlsyajmdxyyainyabakt.supabase.co';

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function getTierFromPrice(priceId) {
  const PRICES = {
    'price_1TKNZ4BimZ1XIzKT4QgWeblP': 'pro',
    'price_1TKNZTBimZ1XIzKTu62QITm9': 'business',
  };
  console.log('Matching price:', priceId, '→', PRICES[priceId] || 'no match');
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

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = getSupabase();

  // Verify webhook signature if secret is set
  let event;
  if (process.env.STRIPE_WEBHOOK_SECRET) {
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
  } else {
    // Fallback: no signature verification (matches your original behavior)
    event = req.body;
  }

  console.log('Stripe event:', event.type);

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;

        console.log('Session mode:', session.mode);
        console.log('Session client_reference_id:', session.client_reference_id);
        console.log('Session customer:', session.customer);
        console.log('Session subscription:', session.subscription);
        console.log('Session metadata:', JSON.stringify(session.metadata));

        // ── CASE 1: Invoice payment (Stripe Connect) ──
        const invoiceId = session.metadata?.invoice_id;
        if (invoiceId) {
          await supabase
            .from('invoices')
            .update({ status: 'Paid' })
            .eq('id', invoiceId);
          console.log('Invoice marked as paid:', invoiceId);
        }

        // ── CASE 2: Subscription purchase (tier upgrade) ──
        if (session.mode === 'subscription' && session.client_reference_id) {
          const userId = session.client_reference_id;
          const customerId = session.customer;
          const subscriptionId = session.subscription;

          console.log('Processing subscription for user:', userId);

          // Get subscription to find tier
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = subscription.items.data[0]?.price?.id;
          const tier = getTierFromPrice(priceId);

          console.log('Price ID:', priceId, '→ Tier:', tier);

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
                console.log('Cancelled old subscription:', existing.stripe_subscription_id);
              } catch (e) {
                console.warn('Could not cancel old sub:', e.message);
              }
            }

            await supabase.from('profiles').update({
              subscription_tier: tier,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              updated_at: new Date().toISOString(),
            }).eq('id', userId);

            console.log(`User ${userId} upgraded to ${tier}`);
          }
        }
        break;
      }

      // ── Subscription changed (via Customer Portal) ──
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
            console.log(`User ${userId} changed to ${tier}`);
          }
        }
        break;
      }

      // ── Subscription cancelled ──
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = await findUserByCustomer(supabase, subscription.customer);
        if (userId) {
          await supabase.from('profiles').update({
            subscription_tier: 'free',
            stripe_subscription_id: null,
            updated_at: new Date().toISOString(),
          }).eq('id', userId);
          console.log(`User ${userId} downgraded to free`);
        }
        break;
      }

      // ── Payment failed — Stripe retries automatically ──
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const userId = await findUserByCustomer(supabase, invoice.customer);
        if (userId) console.log(`Payment failed for user ${userId} — Stripe will retry`);
        break;
      }

      default:
        console.log('Unhandled event:', event.type);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).json({ received: true, error: err.message });
  }
};

// Disable body parsing for signature verification
module.exports.config = {
  api: { bodyParser: false },
};
