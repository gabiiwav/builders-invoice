// /api/stripe-checkout.js
// Creates a Stripe Checkout Session for one-time invoice payments
// Supports both direct payments and Stripe Connect

const Stripe = require('stripe');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { invoice_id, amount_cents, description, stripe_account_id, success_url, cancel_url } = req.body;

    if (!amount_cents || !invoice_id) {
      return res.status(400).json({ error: 'amount_cents and invoice_id required' });
    }

    const sessionParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: description || 'Invoice Payment',
          },
          unit_amount: amount_cents,
        },
        quantity: 1,
      }],
      success_url: success_url || 'https://www.buildersinvoice.com/app.html?payment=success&invoice=' + invoice_id,
      cancel_url: cancel_url || 'https://www.buildersinvoice.com/app.html?payment=cancelled&invoice=' + invoice_id,
      metadata: {
        invoice_id: invoice_id,
      },
    };

    // If Stripe Connect account provided, route payment to connected account
    if (stripe_account_id) {
      sessionParams.payment_intent_data = {
        application_fee_amount: Math.round(amount_cents * 0.01), // 1% platform fee
        transfer_data: {
          destination: stripe_account_id,
        },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
};
