const Stripe = require('stripe');
const { requireUser, getAppOrigin, sendError } = require('../lib/server-auth');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { user, supabase } = await requireUser(req);
    const appOrigin = getAppOrigin(req);

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_account_id')
      .eq('id', user.id)
      .single();

    let accountId = profile?.stripe_account_id;

    if (!accountId) {
      // Create new Stripe Connect account
      const account = await stripe.accounts.create({
        type: 'standard',
        email: user.email || undefined,
      });
      accountId = account.id;

      // Save to profile
      await supabase
        .from('profiles')
        .update({ stripe_account_id: accountId })
        .eq('id', user.id);
    }

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: appOrigin + '/app.html?stripe=refresh',
      return_url: appOrigin + '/app.html?stripe=connected',
      type: 'account_onboarding',
    });

    res.status(200).json({ url: accountLink.url, account_id: accountId });
  } catch (err) {
    return sendError(res, err, 'Stripe Connect error:');
  }
};
