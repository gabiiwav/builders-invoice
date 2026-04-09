// /api/stripe-portal.js
// Creates a Stripe Customer Portal session for managing subscriptions
//
// ENV VARS NEEDED:
//   STRIPE_SECRET_KEY    — sk_test_xxx or sk_live_xxx
//   SUPABASE_URL         — your Supabase project URL
//   SUPABASE_SERVICE_KEY — your Supabase service_role key

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://tlsyajmdxyyainyabakt.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_id, return_url } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id required' });
    }

    // Look up Stripe customer ID from profiles
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user_id)
      .single();

    if (error || !profile?.stripe_customer_id) {
      return res.status(400).json({ error: 'No Stripe subscription found. Subscribe to a plan first.' });
    }

    // Create portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: return_url || req.headers.origin || 'https://your-app.vercel.app',
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err);
    return res.status(500).json({ error: err.message });
  }
};
