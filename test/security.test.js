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
  assert.doesNotMatch(source, /transfer_data|application_fee_amount/);
  assert.doesNotMatch(source, /req\.body[^;]*(amount_cents|stripe_account_id|success_url|cancel_url)/s);
  assert.match(source, /\/api\/invoice-payment\?invoice_id=/);
});

test('webhook fails closed and verifies the Stripe signature', () => {
  const source = readFileSync('api/stripe-webhook.js', 'utf8');
  assert.match(source, /STRIPE_CONNECT_WEBHOOK_SECRET/);
  assert.match(source, /stripe\.webhooks\.constructEvent/);
  assert.match(source, /complete_invoice_payment/);
  assert.match(source, /record_invoice_refund/);
  assert.match(source, /Webhook processing failed/);
});

test('Stripe Connect uses signed Standard OAuth instead of platform-created accounts', () => {
  const connect = readFileSync('api/stripe-connect.js', 'utf8');
  const callback = readFileSync('api/stripe-connect-callback.js', 'utf8');
  assert.match(connect, /connect\.stripe\.com\/oauth\/authorize/);
  assert.match(connect, /createHmac\('sha256'/);
  assert.doesNotMatch(connect, /accounts\.create|accountLinks\.create/);
  assert.match(callback, /stripe\.oauth\.token/);
  assert.match(callback, /timingSafeEqual/);
  assert.match(callback, /stripe_account_id:\s*response\.stripe_user_id/);
});

test('invoice payment attempts prevent duplicates and use Stripe idempotency', () => {
  const endpoint = readFileSync('api/invoice-payment.js', 'utf8');
  const migration = readFileSync('supabase/migrations/202607240001_payment_safety.sql', 'utf8');
  assert.match(endpoint, /idempotencyKey:\s*`invoice-payment-\$\{attemptId\}`/);
  assert.match(endpoint, /\.in\('status', \['creating', 'open'\]\)/);
  assert.match(endpoint, /insertError\.code === '23505'/);
  assert.match(endpoint, /active\?\.status === 'creating'/);
  assert.match(endpoint, /\.eq\('status', 'creating'\)[\s\S]*\.select\('id'\)[\s\S]*\.single\(\)/);
  assert.match(endpoint, /stripe\.checkout\.sessions\.expire/);
  assert.match(migration, /create unique index if not exists one_active_invoice_payment_attempt/i);
  assert.match(migration, /where status in \('creating','open'\)/i);
});

test('active card payments lock invoice amounts and settle atomically', () => {
  const migration = readFileSync('supabase/migrations/202607240001_payment_safety.sql', 'utf8');
  assert.match(migration, /before update on public\.invoices/i);
  assert.match(migration, /new\.total_cents is distinct from old\.total_cents/i);
  assert.match(migration, /create or replace function public\.complete_invoice_payment/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /coalesce\(invoice_row\.total_cents[\s\S]*<> attempt\.amount_cents/i);
  assert.match(migration, /update public\.invoices set status = 'Paid'/i);
});

test('missed webhooks have authenticated reconciliation and refunds stay on connected accounts', () => {
  const reconcile = readFileSync('api/stripe-reconcile.js', 'utf8');
  const checkout = readFileSync('api/invoice-payment.js', 'utf8');
  assert.match(reconcile, /CRON_SECRET/);
  assert.match(reconcile, /complete_invoice_payment/);
  assert.match(reconcile, /stripeAccount:\s*attempt\.stripe_account_id/);
  assert.match(checkout, /stripeAccount:\s*profile\.stripe_account_id/);
  assert.doesNotMatch(checkout, /transfer_data|application_fee_amount/);
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
