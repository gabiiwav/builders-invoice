const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const protectedRoutes = [
  'stripe-checkout',
  'stripe-connect-status',
  'stripe-connect',
  'stripe-portal',
  'stripe-subscribe',
  'redeem-tester-access',
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
test('tester access is server redeemed and cannot overwrite paid billing state', () => {
  const api = readFileSync('api/redeem-tester-access.js', 'utf8');
  const migration = readFileSync('supabase/migrations/202607200005_tester_access.sql', 'utf8');
  assert.match(api, /await requireUser\(req\)/);
  assert.match(api, /matchesTesterCode/);
  assert.match(api, /redeem_tester_campaign/);
  assert.match(migration, /unique \(user_id\)/i);
  assert.match(migration, /tester_access_expires_at/);
  assert.match(migration, /tester_expires > now\(\)/);
  assert.doesNotMatch(migration, /set subscription_tier = 'business'/i);
});

test('tester redemption fix relies on service-role execute privilege', () => {
  const migration = readFileSync('supabase/migrations/202607230001_fix_tester_redemption.sql', 'utf8');
  assert.doesNotMatch(migration, /if current_user/);
  assert.match(migration, /revoke all on function public\.redeem_tester_campaign\(uuid,text\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.redeem_tester_campaign\(uuid,text\) to service_role/i);
});

test('tester code modal is shown after login instead of requiring settings navigation', () => {
  const html = readFileSync('app.html', 'utf8');
  const browser = readFileSync('public/legacy-app.js', 'utf8');
  assert.match(html, /id="testerAccessModal"/);
  assert.match(html, /Activate 60-Day Business Access/);
  assert.match(browser, /setTimeout\(showTesterAccessModal, 250\)/);
  assert.doesNotMatch(browser, /setTimeout\(\(\) => redeemTesterAccess\(pendingTesterCode\)/);
});
