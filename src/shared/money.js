export function toCents(value) {
  const normalized = typeof value === 'string' ? value.replace(/[$,\s]/g, '') : value;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100);
}

export function centsToNumber(cents) {
  return (Number(cents) || 0) / 100;
}

export function formatCents(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(centsToNumber(cents));
}

export function sumCents(values) {
  return values.reduce((sum, value) => sum + (Number(value) || 0), 0);
}
