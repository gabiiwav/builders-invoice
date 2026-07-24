const Stripe = require('stripe');
const { getServiceClient, sendError } = require('../lib/server-auth');

function authorized(req) {
  const configured = process.env.CRON_SECRET;
  return configured && req.headers.authorization === `Bearer ${configured}`;
}

async function completeAttempt(stripe, supabase, attempt, session) {
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
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = getServiceClient();
  try {
    const { data: attempts, error } = await supabase
      .from('invoice_payment_attempts')
      .select('*')
      .in('status', ['creating', 'open'])
      .order('created_at', { ascending: true })
      .limit(100);
    if (error) throw error;

    const result = { checked: 0, paid: 0, expired: 0, errors: 0 };
    for (const attempt of attempts || []) {
      result.checked += 1;
      try {
        if (!attempt.stripe_session_id) {
          if (Date.now() - new Date(attempt.created_at).getTime() > 5 * 60 * 1000) {
            await supabase.from('invoice_payment_attempts')
              .update({
                status: 'failed',
                failure_reason: 'Session creation did not complete',
                updated_at: new Date().toISOString(),
              })
              .eq('id', attempt.id)
              .eq('status', 'creating');
          }
          continue;
        }
        const session = await stripe.checkout.sessions.retrieve(
          attempt.stripe_session_id,
          { stripeAccount: attempt.stripe_account_id },
        );
        if (session.payment_status === 'paid') {
          await completeAttempt(stripe, supabase, attempt, session);
          result.paid += 1;
        } else if (session.status === 'expired') {
          await supabase.from('invoice_payment_attempts')
            .update({ status: 'expired', updated_at: new Date().toISOString() })
            .eq('id', attempt.id)
            .eq('status', 'open');
          result.expired += 1;
        }
      } catch (err) {
        console.error('Stripe reconciliation attempt failed:', attempt.id, err);
        result.errors += 1;
      }
    }
    return res.status(result.errors ? 207 : 200).json(result);
  } catch (err) {
    return sendError(res, err, 'Stripe reconciliation error:');
  }
};
