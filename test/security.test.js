const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const protectedRoutes = [
  'stripe-checkout',
  'stripe-connect-status',
  'stripe-connect',
  'stripe-portal',
  'stripe-subscribe',
];

for (const route of protectedRoutes) {
  test(`${route} verifies the authenticated user`, () => {
    const source = readFileSync(`api/${route}.js`, 'utf8');
    assert.match(source, /await requireUser\(req\)/);
    assert.doesNotMatch(source, /Access-Control-Allow-Origin['"],?\s*['"]\*/);
  });
}

test('invoice checkout derives payment values from database records', () => {
  const source = readFileSync('api/stripe-checkout.js', 'utf8');
  assert.match(source, /\.from\('invoices'\)/);
  assert.match(source, /\.from\('profiles'\)/);
  assert.doesNotMatch(source, /req\.body[^;]*(amount_cents|stripe_account_id|success_url|cancel_url)/s);
});

test('webhook fails closed and verifies the Stripe signature', () => {
  const source = readFileSync('api/stripe-webhook.js', 'utf8');
  assert.match(source, /if \(!process\.env\.STRIPE_WEBHOOK_SECRET\)/);
  assert.match(source, /stripe\.webhooks\.constructEvent/);
  assert.match(source, /Webhook processing failed/);
});

test('shared documents require an exact UUID and disable caching', () => {
  const source = readFileSync('api/shared-document.js', 'utf8');
  assert.match(source, /\^\[0-9a-f\]/);
  assert.match(source, /private, no-store/);
});
