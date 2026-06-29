// /api/stripe-connect-status.js
// Checks if a Stripe Connect account has completed onboarding

const Stripe = require('stripe');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { account_id } = req.body;
    if (!account_id) return res.status(400).json({ error: 'account_id required' });

    const account = await stripe.accounts.retrieve(account_id);

    return res.status(200).json({
      charges_enabled: account.charges_enabled || false,
      payouts_enabled: account.payouts_enabled || false,
      details_submitted: account.details_submitted || false,
    });
  } catch (err) {
    console.error('Connect status error:', err);
    return res.status(500).json({ error: err.message, charges_enabled: false });
  }
};
