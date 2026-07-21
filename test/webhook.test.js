const test = require('node:test');
const assert = require('node:assert/strict');

const { getTierFromPrice, updateProfile } = require('../lib/stripe-subscriptions');

test('webhook recognizes configured subscription price IDs', () => {
  const previousPro = process.env.STRIPE_PRO_PRICE_ID;
  const previousBusiness = process.env.STRIPE_BUSINESS_PRICE_ID;
  process.env.STRIPE_PRO_PRICE_ID = 'price_custom_pro';
  process.env.STRIPE_BUSINESS_PRICE_ID = 'price_custom_business';
  try {
    assert.equal(getTierFromPrice('price_custom_pro'), 'pro');
    assert.equal(getTierFromPrice('price_custom_business'), 'business');
    assert.equal(getTierFromPrice('price_attacker'), null);
  } finally {
    if (previousPro === undefined) delete process.env.STRIPE_PRO_PRICE_ID;
    else process.env.STRIPE_PRO_PRICE_ID = previousPro;
    if (previousBusiness === undefined) delete process.env.STRIPE_BUSINESS_PRICE_ID;
    else process.env.STRIPE_BUSINESS_PRICE_ID = previousBusiness;
  }
});

test('webhook profile updates propagate database failures so Stripe retries', async () => {
  const databaseError = new Error('database unavailable');
  const query = {
    update() { return this; },
    async eq() { return { error: databaseError }; },
  };
  const supabase = { from(table) { assert.equal(table, 'profiles'); return query; } };
  await assert.rejects(updateProfile(supabase, 'user-1', { subscription_tier: 'pro' }), databaseError);
});

test('webhook profile updates complete when the database succeeds', async () => {
  let selectedUser;
  const query = {
    update(values) { assert.deepEqual(values, { subscription_tier: 'free' }); return this; },
    async eq(column, value) { assert.equal(column, 'id'); selectedUser = value; return { error: null }; },
  };
  await updateProfile({ from: () => query }, 'user-1', { subscription_tier: 'free' });
  assert.equal(selectedUser, 'user-1');
});
