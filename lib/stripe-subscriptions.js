function getTierFromPrice(priceId) {
  const prices = {};
  if (process.env.STRIPE_PRO_PRICE_ID) prices[process.env.STRIPE_PRO_PRICE_ID] = 'pro';
  if (process.env.STRIPE_BUSINESS_PRICE_ID) prices[process.env.STRIPE_BUSINESS_PRICE_ID] = 'business';
  return prices[priceId] || null;
}

async function updateProfile(supabase, userId, values) {
  const { error } = await supabase.from('profiles').update(values).eq('id', userId);
  if (error) throw error;
}

module.exports = { getTierFromPrice, updateProfile };
