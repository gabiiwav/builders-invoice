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
    const { user_id, user_email, return_url } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    // Check if user already has a Stripe account
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      'https://tlsyajmdxyyainyabakt.supabase.co',
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_account_id')
      .eq('id', user_id)
      .single();

    let accountId = profile?.stripe_account_id;

    if (!accountId) {
      // Create new Stripe Connect account
      const account = await stripe.accounts.create({
        type: 'standard',
        email: user_email || undefined,
      });
      accountId = account.id;

      // Save to profile
      await supabase
        .from('profiles')
        .update({ stripe_account_id: accountId })
        .eq('id', user_id);
    }

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: return_url || 'https://builders-invoice.vercel.app/',
      return_url: return_url || 'https://builders-invoice.vercel.app/',
      type: 'account_onboarding',
    });

    res.status(200).json({ url: accountLink.url, account_id: accountId });
  } catch (err) {
    console.error('Stripe Connect error:', err);
    res.status(500).json({ error: err.message });
  }
};
