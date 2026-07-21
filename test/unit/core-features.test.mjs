import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { calculateDocumentTotals, calculateLineItem, calculateProfitAndLoss } from '../../src/domain/calculations.js';
import { createRepositories } from '../../src/data/repositories.js';
import { toCents, centsToNumber, sumCents } from '../../src/shared/money.js';
import { isValidEmail, validateDocumentInput } from '../../src/shared/validation.js';

const require = createRequire(import.meta.url);
const { getAppOrigin } = require('../../lib/server-auth.js');

test('money conversion handles currency strings, rounding, and invalid input', () => {
  assert.equal(toCents('$1,234.567'), 123457);
  assert.equal(toCents(10.005), 1001);
  assert.equal(toCents('not money'), 0);
  assert.equal(centsToNumber(12345), 123.45);
  assert.equal(sumCents([100, 250, undefined]), 350);
});

test('line items support percentage, fixed, disabled, and fractional quantity markup', () => {
  assert.equal(calculateLineItem({ qty: 2, rate: 10, markupEnabled: true, markupMode: 'percent', markupValue: 25 }).totalCents, 2500);
  assert.equal(calculateLineItem({ qty: 3, rate: 10, markupEnabled: true, markupMode: 'fixed', markupValue: 2.5 }).totalCents, 3750);
  assert.equal(calculateLineItem({ qty: 1.5, rate: 20, markupEnabled: false, markupValue: 99 }).totalCents, 3000);
});

test('document totals tax all work plus overhead when scope is all', () => {
  const totals = calculateDocumentTotals({
    items: [{ qty: 1, rate: 100, lineType: 'labor' }],
    overheadPercent: 10,
    taxEnabled: true,
    taxRate: 5,
    taxScope: 'all',
  });
  assert.deepEqual(
    [totals.subtotalCents, totals.overheadCents, totals.taxCents, totals.totalCents],
    [10000, 1000, 550, 11550],
  );
});

test('materials-only tax excludes labor and overhead', () => {
  const totals = calculateDocumentTotals({
    items: [
      { qty: 2, rate: 25, lineType: 'material' },
      { qty: 1, rate: 100, lineType: 'labor' },
    ],
    overheadPercent: 10,
    taxEnabled: true,
    taxRate: 8,
    taxScope: 'materials',
  });
  assert.equal(totals.taxCents, 400);
  assert.equal(totals.totalCents, 16900);
});

test('profit and loss respects month, paid status, automatic costs, and zero revenue', () => {
  const result = calculateProfitAndLoss({
    year: 2026,
    month: 6,
    invoices: [
      { status: 'Paid', date: '2026-07-31', totalCents: 20000, items: [{ qty: 2, rate: 30, lineType: 'material' }, { qty: 1, rate: 50, lineType: 'other' }] },
      { status: 'Paid', date: '2026-08-01', totalCents: 90000, items: [] },
      { status: 'Sent', date: '2026-07-10', totalCents: 90000, items: [] },
    ],
    expenses: [{ date: '2026-07-01', amountCents: 2500 }, { date: '2026-08-01', amountCents: 9999 }],
  });
  assert.equal(result.revenueCents, 20000);
  assert.equal(result.automaticCostCents, 6000);
  assert.equal(result.expenseCents, 8500);
  assert.equal(result.profitCents, 11500);
  assert.ok(Math.abs(result.marginPercent - 57.5) < Number.EPSILON * 100);

  const empty = calculateProfitAndLoss({ year: 2026, month: 0, invoices: [], expenses: [] });
  assert.equal(empty.marginPercent, 0);
});

test('quote and invoice validation rejects missing critical customer and item data', () => {
  assert.equal(isValidEmail('builder@example.com'), true);
  assert.equal(isValidEmail('bad@'), false);
  const invalid = validateDocumentInput({ clientName: ' ', clientEmail: 'bad', jobDesc: '', items: [{ qty: 0, rate: 100 }] });
  assert.equal(invalid.valid, false);
  assert.deepEqual(Object.keys(invalid.errors).sort(), ['clientEmail', 'clientName', 'items', 'jobDescription']);
  assert.equal(validateDocumentInput({ clientName: 'A', clientEmail: 'a@b.com', jobDesc: 'Roof', items: [{ qty: 1, rate: 1 }] }).valid, true);
});

test('repositories refuse unauthenticated writes before calling Supabase', async () => {
  let calls = 0;
  const repositories = createRepositories({ rpc: async () => { calls += 1; } }, () => null);
  await assert.rejects(repositories.quotes.save({}, []), /Authentication required/);
  await assert.rejects(repositories.invoices.save({}, []), /Authentication required/);
  assert.equal(calls, 0);
});

test('repositories use atomic RPCs and propagate database failures', async () => {
  const calls = [];
  const supabase = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'save_invoice_with_items') return { data: null, error: new Error('transaction failed') };
      return { data: 'quote-id', error: null };
    },
  };
  const repositories = createRepositories(supabase, () => ({ id: 'user-1' }));
  assert.equal(await repositories.quotes.save({ status: 'Draft' }, [{ qty: 1 }]), 'quote-id');
  await assert.rejects(repositories.invoices.save({}, []), /transaction failed/);
  assert.equal(calls[0].name, 'save_quote_with_items');
  assert.deepEqual(calls[0].args.items, [{ qty: 1 }]);
});

test('application redirects use configured origin and reject attacker-controlled origins', () => {
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'https://www.buildersinvoice.com/path';
  try {
    assert.equal(getAppOrigin({ headers: { origin: 'https://evil.example' } }), 'https://www.buildersinvoice.com');
    assert.equal(getAppOrigin({ headers: { origin: 'http://localhost:5173' } }), 'http://localhost:5173');
  } finally {
    if (previous === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previous;
  }
});
