// /api/stripe-portal.js
// Creates a Stripe Customer Portal session for managing subscriptions
//
// ENV VARS NEEDED:
//   STRIPE_SECRET_KEY    — sk_test_xxx or sk_live_xxx
//   SUPABASE_URL         — your Supabase project URL
//   SUPABASE_SERVICE_KEY — your Supabase service_role key

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { requireUser, getAppOrigin, sendError } = require('../lib/server-auth');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user, supabase: authenticatedSupabase } = await requireUser(req);

    // Look up Stripe customer ID from profiles
    const { data: profile, error } = await authenticatedSupabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    if (error || !profile?.stripe_customer_id) {
      return res.status(400).json({ error: 'No Stripe subscription found. Subscribe to a plan first.' });
    }

    // Create portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: getAppOrigin(req) + '/app.html',
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return sendError(res, err, 'Portal error:');
  }
};
