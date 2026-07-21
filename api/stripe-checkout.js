// /api/stripe-checkout.js
// Creates a Stripe Checkout Session for one-time invoice payments
// Supports both direct payments and Stripe Connect

const Stripe = require('stripe');
const { requireUser, getAppOrigin, sendError } = require('../lib/server-auth');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { user, supabase } = await requireUser(req);
    const { invoice_id } = req.body || {};
    if (!invoice_id) {
      return res.status(400).json({ error: 'invoice_id required' });
    }

    const [{ data: invoice, error: invoiceError }, { data: profile, error: profileError }] = await Promise.all([
      supabase.from('invoices')
        .select('id, user_id, invoice_num, job_desc, total, total_cents, status')
        .eq('id', invoice_id)
        .eq('user_id', user.id)
        .single(),
      supabase.from('profiles')
        .select('stripe_account_id')
        .eq('id', user.id)
        .single(),
    ]);

    if (invoiceError || !invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (profileError || !profile?.stripe_account_id) {
      return res.status(400).json({ error: 'Connect Stripe before accepting card payments' });
    }
    if (invoice.status === 'Paid') return res.status(409).json({ error: 'Invoice is already paid' });

    const amountCents = Number.isSafeInteger(Number(invoice.total_cents))
      ? Number(invoice.total_cents)
      : Math.round(Number(invoice.total) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents < 50) {
      return res.status(400).json({ error: 'Invoice total is not payable' });
    }

    const appUrl = getAppOrigin(req) + '/app.html';

    const sessionParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: invoice.job_desc || `Invoice ${invoice.invoice_num || ''}`.trim(),
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      success_url: appUrl + '?payment=success&invoice=' + encodeURIComponent(invoice.id),
      cancel_url: appUrl + '?payment=cancelled&invoice=' + encodeURIComponent(invoice.id),
      metadata: {
        invoice_id: invoice_id,
        user_id: user.id,
        expected_amount_cents: String(amountCents),
      },
    };

    sessionParams.payment_intent_data = {
      application_fee_amount: Math.round(amountCents * 0.01),
      transfer_data: { destination: profile.stripe_account_id },
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return sendError(res, err, 'Invoice checkout error:');
  }
};
