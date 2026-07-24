const crypto = require('node:crypto');
const { requireUser, getAppOrigin, sendError } = require('../lib/server-auth');

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(payload) {
  const secret = process.env.STRIPE_CONNECT_STATE_SECRET || process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('Stripe Connect state signing is not configured');
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user } = await requireUser(req);
    const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
    if (!clientId) throw new Error('STRIPE_CONNECT_CLIENT_ID is not configured');

    const appOrigin = getAppOrigin(req);
    const redirectUri = appOrigin + '/api/stripe-connect-callback';
    const payload = encode({
      user_id: user.id,
      expires_at: Date.now() + 10 * 60 * 1000,
    });
    const state = payload + '.' + sign(payload);

    const authorizeUrl = new URL('https://connect.stripe.com/oauth/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('scope', 'read_write');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);

    return res.status(200).json({ url: authorizeUrl.toString() });
  } catch (err) {
    return sendError(res, err, 'Stripe Connect error:');
  }
};
