const { createClient } = require('@supabase/supabase-js');

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || 'https://tlsyajmdxyyainyabakt.supabase.co';
}

function getServiceClient() {
  if (!process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_SERVICE_KEY is not configured');
  }
  return createClient(getSupabaseUrl(), process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireUser(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error('Authentication required');
    error.statusCode = 401;
    throw error;
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase.auth.getUser(match[1]);
  if (error || !data?.user) {
    const authError = new Error('Invalid or expired session');
    authError.statusCode = 401;
    throw authError;
  }

  return { user: data.user, supabase };
}

function getAppOrigin(req) {
  const configured = process.env.APP_ORIGIN || 'https://www.buildersinvoice.com';
  const origin = new URL(configured);
  if (!['http:', 'https:'].includes(origin.protocol)) {
    throw new Error('APP_ORIGIN must be an HTTP(S) URL');
  }

  // Local previews remain usable without allowing caller-controlled production redirects.
  const requestOrigin = req.headers.origin;
  if (requestOrigin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestOrigin)) {
    return requestOrigin;
  }
  return origin.origin;
}

function sendError(res, err, label) {
  const status = err.statusCode || 500;
  if (status >= 500) console.error(label, err);
  return res.status(status).json({ error: status >= 500 ? 'Server error' : err.message });
}

module.exports = { getServiceClient, requireUser, getAppOrigin, sendError };
