const { requireUser, sendError } = require('../lib/server-auth');
const { matchesTesterCode } = require('../lib/tester-access');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { user, supabase } = await requireUser(req);
    const code = req.body?.code;
    if (!code || !matchesTesterCode(code, process.env.TESTER_ACCESS_CODE_HASH)) {
      return res.status(400).json({ error: 'Invalid tester access code' });
    }
    const { data, error } = await supabase.rpc('redeem_tester_campaign', {
      target_user_id: user.id,
      campaign_key: 'builders-beta-2026',
    });
    if (error) throw error;
    return res.status(200).json(data);
  } catch (error) {
    if (error.code === 'P0001' || error.code === 'P0002') {
      error.statusCode = 400;
      error.message = error.message.replace(/^.*?: /, '');
    }
    return sendError(res, error, 'Tester access redemption error:');
  }
};
