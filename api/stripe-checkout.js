// Returns a permanent Builders Invoice payment URL for an owned invoice.
// A fresh/reusable Stripe Checkout Session is resolved only when the customer
// opens that URL, avoiding expired links in long-lived invoice emails.

const Stripe = require('stripe');
const { requireUser, getAppOrigin, sendError } = require('../lib/server-auth');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, supabase } = await requireUser(req);
    const { invoice_id } = req.body || {};
    if (!/^[0-9a-f-]{36}$/i.test(String(invoice_id || ''))) {
      return res.status(400).json({ error: 'Valid invoice_id required' });
    }

    const [{ data: invoice, error: invoiceError }, { data: profile, error: profileError }] = await Promise.all([
      supabase.from('invoices')
        .select('id, user_id, total, total_cents, status')
        .eq('id', invoice_id)
        .eq('user_id', user.id)
        .single(),
      supabase.from('profiles')
        .select('stripe_account_id')
        .eq('id', user.id)
        .single(),
    ]);

    if (invoiceError || !invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (['Paid', 'Refunded', 'Partially Refunded'].includes(invoice.status)) {
      return res.status(409).json({ error: 'Invoice has already received a card payment' });
    }
    if (profileError || !profile?.stripe_account_id) {
      return res.status(400).json({ error: 'Connect Stripe before accepting card payments' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const account = await stripe.accounts.retrieve(profile.stripe_account_id);
    if (!account.charges_enabled || !account.details_submitted) {
      return res.status(400).json({ error: 'Finish Stripe onboarding before accepting card payments' });
    }

    const amountCents = Number.isSafeInteger(Number(invoice.total_cents))
      ? Number(invoice.total_cents)
      : Math.round(Number(invoice.total) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents < 50) {
      return res.status(400).json({ error: 'Invoice total is not payable' });
    }

    const url = getAppOrigin(req) + '/api/invoice-payment?invoice_id='
      + encodeURIComponent(invoice.id);
    return res.status(200).json({ url });
  } catch (err) {
    return sendError(res, err, 'Invoice payment URL error:');
  }
};
