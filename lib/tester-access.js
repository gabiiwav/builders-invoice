const { createHash, timingSafeEqual } = require('node:crypto');

function normalizeTesterCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function hashTesterCode(value) {
  return createHash('sha256').update(normalizeTesterCode(value)).digest('hex');
}

function matchesTesterCode(value, expectedHash) {
  if (!/^[a-f0-9]{64}$/i.test(String(expectedHash || ''))) return false;
  const actual = Buffer.from(hashTesterCode(value), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

module.exports = { hashTesterCode, matchesTesterCode, normalizeTesterCode };
