// /api/stripe-subscribe.js
// Creates a Stripe Checkout Session for subscription upgrades
// Returns a checkout URL that redirects back to the app after payment

const Stripe = require('stripe');
const { requireUser, getAppOrigin, sendError } = require('../lib/server-auth');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { user } = await requireUser(req);
    const { tier } = req.body || {};
    const prices = {
      pro: process.env.STRIPE_PRO_PRICE_ID || 'price_1TKNZ4BimZ1XIzKT4QgWeblP',
      business: process.env.STRIPE_BUSINESS_PRICE_ID || 'price_1TKNZTBimZ1XIzKTu62QITm9',
    };
    const priceId = prices[tier];
    if (!priceId) {
      return res.status(400).json({ error: 'Valid tier required' });
    }

    const appUrl = getAppOrigin(req) + '/app.html';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      customer_email: user.email || undefined,
      success_url: appUrl + '?upgraded=true',
      cancel_url: appUrl,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return sendError(res, err, 'Subscription checkout error:');
  }
};
