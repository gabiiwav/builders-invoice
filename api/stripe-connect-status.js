// /api/stripe-connect-status.js
// Checks if a Stripe Connect account has completed onboarding

const Stripe = require('stripe');
const { requireUser, sendError } = require('../lib/server-auth');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { user, supabase } = await requireUser(req);
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('stripe_account_id')
      .eq('id', user.id)
      .single();
    if (error || !profile?.stripe_account_id) {
      return res.status(404).json({ error: 'Stripe account not found' });
    }

    const account = await stripe.accounts.retrieve(profile.stripe_account_id);

    return res.status(200).json({
      charges_enabled: account.charges_enabled || false,
      payouts_enabled: account.payouts_enabled || false,
      details_submitted: account.details_submitted || false,
    });
  } catch (err) {
    return sendError(res, err, 'Connect status error:');
  }
};
