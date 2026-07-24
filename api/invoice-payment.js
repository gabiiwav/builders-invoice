const crypto = require('node:crypto');
const Stripe = require('stripe');
const { getServiceClient, getAppOrigin, sendError } = require('../lib/server-auth');

function paymentResultUrl(req, state, invoiceId) {
  return getAppOrigin(req) + '/app.html?payment=' + state
    + '&invoice=' + encodeURIComponent(invoiceId);
}

async function expireAttempt(stripe, supabase, attempt) {
  if (attempt.stripe_session_id) {
    try {
      await stripe.checkout.sessions.expire(attempt.stripe_session_id, {
        stripeAccount: attempt.stripe_account_id,
      });
    } catch (err) {
      // Payment can complete between our status check and expiration request.
      // Re-read Stripe before changing local state so a paid Session is never
      // replaced with a second payable attempt.
      if (await settleIfPaid(stripe, supabase, attempt)) return 'paid';
      const latest = await stripe.checkout.sessions.retrieve(
        attempt.stripe_session_id,
        { stripeAccount: attempt.stripe_account_id },
      );
      if (latest.status !== 'expired') throw err;
    }
  }
  await supabase.from('invoice_payment_attempts')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('id', attempt.id)
    .in('status', ['creating', 'open']);
  return 'expired';
}

async function settleIfPaid(stripe, supabase, attempt) {
  if (!attempt?.stripe_session_id) return false;
  const session = await stripe.checkout.sessions.retrieve(
    attempt.stripe_session_id,
    { stripeAccount: attempt.stripe_account_id },
  );
  if (session.payment_status !== 'paid') return false;

  const paymentIntent = await stripe.paymentIntents.retrieve(
    session.payment_intent,
    { stripeAccount: attempt.stripe_account_id },
  );
  const chargeId = typeof paymentIntent.latest_charge === 'string'
    ? paymentIntent.latest_charge
    : paymentIntent.latest_charge?.id;
  const { error } = await supabase.rpc('complete_invoice_payment', {
    attempt_id: attempt.id,
    session_id: session.id,
    connected_account_id: attempt.stripe_account_id,
    paid_amount_cents: session.amount_total,
    payment_intent: session.payment_intent,
    charge: chargeId || null,
  });
  if (error) throw error;
  return true;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();
  const invoiceId = String(req.query?.invoice_id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId)) {
    return res.status(400).send('Invalid invoice payment link.');
  }

  const supabase = getServiceClient();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id,user_id,invoice_num,job_desc,total,total_cents,status,updated_at')
      .eq('id', invoiceId)
      .single();
    if (invoiceError || !invoice) return res.status(404).send('Invoice not found.');
    if (['Paid', 'Refunded', 'Partially Refunded'].includes(invoice.status)) {
      return res.redirect(303, paymentResultUrl(req, 'success', invoice.id));
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_account_id')
      .eq('id', invoice.user_id)
      .single();
    if (profileError || !profile?.stripe_account_id) {
      return res.status(409).send('Card payments are not enabled for this business.');
    }

    const amountCents = Number.isSafeInteger(Number(invoice.total_cents))
      ? Number(invoice.total_cents)
      : Math.round(Number(invoice.total) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents < 50) {
      return res.status(409).send('This invoice does not have a payable balance.');
    }

    const account = await stripe.accounts.retrieve(profile.stripe_account_id);
    if (!account.charges_enabled || !account.details_submitted) {
      return res.status(409).send('Card payments are temporarily unavailable for this business.');
    }

    const { data: activeAttempts, error: activeError } = await supabase
      .from('invoice_payment_attempts')
      .select('*')
      .eq('invoice_id', invoice.id)
      .in('status', ['creating', 'open'])
      .order('created_at', { ascending: false })
      .limit(1);
    if (activeError) throw activeError;
    const active = activeAttempts?.[0];

    if (
      active?.status === 'creating' &&
      Date.now() - new Date(active.created_at).getTime() < 2 * 60 * 1000
    ) {
      return res.status(409).send('A secure payment session is being prepared. Please refresh.');
    }

    if (active?.stripe_session_id && await settleIfPaid(stripe, supabase, active)) {
      return res.redirect(303, paymentResultUrl(req, 'success', invoice.id));
    }

    if (
      active?.status === 'open' &&
      active.checkout_url &&
      new Date(active.expires_at).getTime() > Date.now() &&
      Number(active.amount_cents) === amountCents &&
      active.stripe_account_id === profile.stripe_account_id
    ) {
      return res.redirect(303, active.checkout_url);
    }
    if (active && await expireAttempt(stripe, supabase, active) === 'paid') {
      return res.redirect(303, paymentResultUrl(req, 'success', invoice.id));
    }

    const attemptId = crypto.randomUUID();
    const { error: insertError } = await supabase
      .from('invoice_payment_attempts')
      .insert({
        id: attemptId,
        invoice_id: invoice.id,
        user_id: invoice.user_id,
        stripe_account_id: profile.stripe_account_id,
        amount_cents: amountCents,
        invoice_updated_at: invoice.updated_at,
        status: 'creating',
      });
    if (insertError) {
      // A concurrent request won the unique active-attempt race. The customer
      // can safely retry without creating a second Stripe Session.
      if (insertError.code === '23505') {
        return res.status(409).send('A secure payment session is being prepared. Please refresh.');
      }
      throw insertError;
    }

    try {
      const session = await stripe.checkout.sessions.create({
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
        success_url: paymentResultUrl(req, 'success', invoice.id),
        cancel_url: paymentResultUrl(req, 'cancelled', invoice.id),
        metadata: {
          payment_attempt_id: attemptId,
          invoice_id: invoice.id,
          user_id: invoice.user_id,
          expected_amount_cents: String(amountCents),
          invoice_updated_at: invoice.updated_at,
        },
      }, {
        stripeAccount: profile.stripe_account_id,
        idempotencyKey: `invoice-payment-${attemptId}`,
      });

      const { error: updateError } = await supabase
        .from('invoice_payment_attempts')
        .update({
          status: 'open',
          stripe_session_id: session.id,
          checkout_url: session.url,
          expires_at: new Date(session.expires_at * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', attemptId)
        .eq('status', 'creating')
        .select('id')
        .single();
      if (updateError) {
        try {
          await stripe.checkout.sessions.expire(session.id, {
            stripeAccount: profile.stripe_account_id,
          });
        } catch (err) {}
        throw updateError;
      }

      return res.redirect(303, session.url);
    } catch (err) {
      await supabase.from('invoice_payment_attempts')
        .update({
          status: 'failed',
          failure_reason: String(err.message || err).slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq('id', attemptId)
        .eq('status', 'creating');
      throw err;
    }
  } catch (err) {
    return sendError(res, err, 'Invoice payment error:');
  }
};
