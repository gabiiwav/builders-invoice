function getTierFromPrice(priceId) {
  const prices = {
    [process.env.STRIPE_PRO_PRICE_ID || 'price_1TKNZ4BimZ1XIzKT4QgWeblP']: 'pro',
    [process.env.STRIPE_BUSINESS_PRICE_ID || 'price_1TKNZTBimZ1XIzKTu62QITm9']: 'business',
  };
  return prices[priceId] || null;
}

async function updateProfile(supabase, userId, values) {
  const { error } = await supabase.from('profiles').update(values).eq('id', userId);
  if (error) throw error;
}

module.exports = { getTierFromPrice, updateProfile };
