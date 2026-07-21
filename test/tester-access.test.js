const test = require('node:test');
const assert = require('node:assert/strict');
const { hashTesterCode, matchesTesterCode, normalizeTesterCode } = require('../lib/tester-access');

test('tester codes are normalized consistently', () => {
  assert.equal(normalizeTesterCode(' builders-beta-2026 '), 'BUILDERS-BETA-2026');
  assert.equal(normalizeTesterCode('BUILDERS BETA 2026'), 'BUILDERSBETA2026');
});

test('tester code matching uses the configured SHA-256 hash', () => {
  const hash = hashTesterCode('BUILDERS-BETA-2026');
  assert.equal(matchesTesterCode('builders-beta-2026', hash), true);
  assert.equal(matchesTesterCode('WRONG-CODE', hash), false);
  assert.equal(matchesTesterCode('BUILDERS-BETA-2026', 'bad-config'), false);
});
