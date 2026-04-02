const Stripe = require('stripe');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { invoice_id, amount_cents, description, stripe_account_id, success_url, cancel_url } = req.body;

    if (!invoice_id || !amount_cents || !stripe_account_id) {
      return res.status(400).json({ error: 'invoice_id, amount_cents, and stripe_account_id required' });
    }

    // Create Checkout Session on the connected account
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: description || 'Invoice Payment',
          },
          unit_amount: Math.round(amount_cents),
        },
        quantity: 1,
      }],
      payment_intent_data: {
        // Optional: take a platform fee (e.g. 1%)
        // application_fee_amount: Math.round(amount_cents * 0.01),
      },
      success_url: success_url || `https://builders-invoice.vercel.app/?payment=success&invoice=${invoice_id}`,
      cancel_url: cancel_url || `https://builders-invoice.vercel.app/?payment=cancelled&invoice=${invoice_id}`,
      metadata: {
        invoice_id: invoice_id,
      },
    }, {
      stripeAccount: stripe_account_id,
    });

    // Save payment URL to invoice
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      'https://tlsyajmdxyyainyabakt.supabase.co',
      process.env.SUPABASE_SERVICE_KEY
    );

    await supabase
      .from('invoices')
      .update({
        stripe_payment_id: session.id,
        stripe_payment_url: session.url,
      })
      .eq('id', invoice_id);

    res.status(200).json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('Stripe Checkout error:', err);
    res.status(500).json({ error: err.message });
  }
};
