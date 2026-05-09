// /api/stripe-subscribe.js
// Creates a Stripe Checkout Session for subscription upgrades
// Returns a checkout URL that redirects back to the app after payment

const Stripe = require('stripe');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { price_id, user_id, return_url } = req.body;

    if (!price_id || !user_id) {
      return res.status(400).json({ error: 'price_id and user_id required' });
    }

    const appUrl = return_url || 'https://www.buildersinvoice.com/app.html';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: price_id, quantity: 1 }],
      client_reference_id: user_id,
      success_url: appUrl + '?upgraded=true',
      cancel_url: appUrl,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
};
