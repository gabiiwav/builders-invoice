const crypto = require('node:crypto');
const Stripe = require('stripe');
const { getServiceClient, getAppOrigin } = require('../lib/server-auth');

function sign(payload) {
  const secret = process.env.STRIPE_CONNECT_STATE_SECRET || process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('Stripe Connect state signing is not configured');
  return crypto.createHmac('sha256', secret).update(payload).digest();
}

function readState(state) {
  const [payload, providedSignature, extra] = String(state || '').split('.');
  if (!payload || !providedSignature || extra) throw new Error('Invalid Stripe connection state');

  const expected = sign(payload);
  const provided = Buffer.from(providedSignature, 'base64url');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw new Error('Invalid Stripe connection state');
  }

  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!data.user_id || !Number.isFinite(data.expires_at) || data.expires_at < Date.now()) {
    throw new Error('Stripe connection state expired');
  }
  return data;
}

module.exports = async (req, res) => {
  const appOrigin = getAppOrigin(req);
  const appUrl = appOrigin + '/app.html';
  if (req.method !== 'GET') return res.status(405).end();

  try {
    if (req.query?.error) {
      return res.redirect(303, appUrl + '?stripe=cancelled');
    }

    const state = readState(req.query?.state);
    const code = String(req.query?.code || '');
    if (!code) throw new Error('Stripe authorization code is missing');

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const response = await stripe.oauth.token({
      grant_type: 'authorization_code',
      code,
    });
    if (!response.stripe_user_id) throw new Error('Stripe account was not returned');

    const { error } = await getServiceClient()
      .from('profiles')
      .update({
        stripe_account_id: response.stripe_user_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', state.user_id);
    if (error) throw error;

    return res.redirect(303, appUrl + '?stripe=connected');
  } catch (err) {
    console.error('Stripe Connect callback error:', err);
    return res.redirect(303, appUrl + '?stripe=error');
  }
};
