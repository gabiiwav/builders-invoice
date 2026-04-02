const Stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // For connected accounts, we use the connect webhook
  // In production, verify the webhook signature with STRIPE_WEBHOOK_SECRET
  // For now, we'll process without signature verification in test mode

  try {
    const event = req.body;

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const invoiceId = session.metadata?.invoice_id;

      if (invoiceId) {
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(
          'https://tlsyajmdxyyainyabakt.supabase.co',
          process.env.SUPABASE_SERVICE_KEY
        );

        // Mark invoice as Paid
        await supabase
          .from('invoices')
          .update({ status: 'Paid' })
          .eq('id', invoiceId);

        console.log('Invoice marked as paid:', invoiceId);
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(400).json({ error: err.message });
  }
};
