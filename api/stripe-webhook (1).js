// /api/stripe-webhook.js
// Vercel Serverless Function — handles Stripe subscription events
// 
// ENV VARS NEEDED (set in Vercel dashboard):
//   STRIPE_SECRET_KEY       — sk_test_xxx (test) or sk_live_xxx (live)
//   STRIPE_WEBHOOK_SECRET   — whsec_xxx (from Stripe webhook settings)
//   SUPABASE_URL            — your Supabase project URL
//   SUPABASE_SERVICE_KEY    — your Supabase service_role key (NOT the anon key)
//   STRIPE_PRICE_PRO        — price_xxx for Pro plan
//   STRIPE_PRICE_BUSINESS   — price_xxx for Business plan

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Map Stripe Price IDs to tier names
function getTierFromPrice(priceId) {
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_BUSINESS) return 'business';
  return null;
}

async function updateUserTier(userId, tier, stripeCustomerId, stripeSubscriptionId) {
  const update = {
    subscription_tier: tier,
    updated_at: new Date().toISOString(),
  };
  if (stripeCustomerId) update.stripe_customer_id = stripeCustomerId;
  if (stripeSubscriptionId) update.stripe_subscription_id = stripeSubscriptionId;

  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', userId);

  if (error) {
    console.error('Failed to update tier for user', userId, error);
    return false;
  }
  console.log(`Updated user ${userId} to tier: ${tier}`);
  return true;
}

// Find user by Stripe customer ID (for subscription events after initial checkout)
async function findUserByCustomer(customerId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (error || !data) {
    console.error('No user found for Stripe customer', customerId);
    return null;
  }
  return data.id;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify webhook signature
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // For Vercel, we need the raw body
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const rawBody = Buffer.concat(chunks);

    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log('Stripe event:', event.type);

  try {
    switch (event.type) {

      // ── New subscription via Payment Link ──
      case 'checkout.session.completed': {
        const session = event.data.object;

        // Only handle subscription checkouts
        if (session.mode !== 'subscription') break;

        const userId = session.client_reference_id;
        if (!userId) {
          console.error('No client_reference_id in checkout session');
          break;
        }

        const customerId = session.customer;
        const subscriptionId = session.subscription;

        // Get the subscription to find the price/tier
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price?.id;
        const tier = getTierFromPrice(priceId);

        if (!tier) {
          console.error('Unknown price ID:', priceId);
          break;
        }

        // Check for duplicate subscription
        const { data: existing } = await supabase
          .from('profiles')
          .select('stripe_subscription_id')
          .eq('id', userId)
          .single();

        if (existing?.stripe_subscription_id && existing.stripe_subscription_id !== subscriptionId) {
          // User already has a different subscription — cancel the old one
          try {
            await stripe.subscriptions.cancel(existing.stripe_subscription_id);
            console.log('Cancelled duplicate subscription:', existing.stripe_subscription_id);
          } catch (e) {
            console.warn('Could not cancel old subscription:', e.message);
          }
        }

        await updateUserTier(userId, tier, customerId, subscriptionId);
        break;
      }

      // ── Subscription changed (upgrade/downgrade via Customer Portal) ──
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const userId = await findUserByCustomer(customerId);
        if (!userId) break;

        // Check if subscription is still active
        if (subscription.status === 'active' || subscription.status === 'trialing') {
          const priceId = subscription.items.data[0]?.price?.id;
          const tier = getTierFromPrice(priceId);
          if (tier) {
            await updateUserTier(userId, tier, customerId, subscription.id);
          }
        }
        break;
      }

      // ── Subscription cancelled ──
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const userId = await findUserByCustomer(customerId);
        if (!userId) break;

        await updateUserTier(userId, 'free', customerId, null);
        console.log(`User ${userId} downgraded to free (subscription cancelled)`);
        break;
      }

      // ── Payment failed on renewal ──
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const userId = await findUserByCustomer(customerId);
        if (!userId) break;

        // Don't immediately downgrade — Stripe retries failed payments
        // Just log it. Stripe will send customer.subscription.deleted if all retries fail.
        console.log(`Payment failed for user ${userId} — Stripe will retry`);
        break;
      }

      default:
        console.log('Unhandled event type:', event.type);
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    // Still return 200 so Stripe doesn't retry
    return res.status(200).json({ received: true, error: err.message });
  }

  return res.status(200).json({ received: true });
};

// Disable body parsing — we need the raw body for signature verification
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
