const test = require('node:test');
const assert = require('node:assert/strict');

process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
process.env.SUPABASE_SERVICE_KEY = 'placeholder';

function response() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

for (const route of [
  'stripe-checkout',
  'stripe-connect-status',
  'stripe-connect',
  'stripe-portal',
  'stripe-subscribe',
]) {
  test(`${route} rejects unauthenticated requests`, async () => {
    const handler = require(`../api/${route}`);
    const res = response();
    await handler({ method: 'POST', headers: {}, body: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'Authentication required');
  });
}

test('webhook fails closed without a signing secret', async () => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const handler = require('../api/stripe-webhook');
  const res = response();
  await handler({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 500);
});

test('shared document endpoint rejects non-UUID identifiers', async () => {
  const handler = require('../api/shared-document');
  const res = response();
  await handler({ method: 'GET', query: { id: 'not-a-uuid' } }, res);
  assert.equal(res.statusCode, 400);
});
