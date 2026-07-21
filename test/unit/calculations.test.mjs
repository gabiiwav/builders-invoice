import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDocumentTotals, calculateProfitAndLoss } from '../../src/domain/calculations.js';

test('document calculations use integer cents', () => {
  const result = calculateDocumentTotals({
    items: [{ qty: 2, rate: 10, markupEnabled: true, markupMode: 'percent', markupValue: 25 }],
    overheadPercent: 10,
    taxEnabled: true,
    taxRate: 8,
  });
  assert.equal(result.subtotalCents, 2500);
  assert.equal(result.overheadCents, 250);
  assert.equal(result.taxCents, 220);
  assert.equal(result.totalCents, 2970);
});

test('profit and loss counts only paid invoices as revenue', () => {
  const result = calculateProfitAndLoss({
    year: 2026,
    month: 6,
    invoices: [
      { status: 'Paid', date: '2026-07-10', total: '$100.00', items: [] },
      { status: 'Sent', date: '2026-07-11', total: '$900.00', items: [] },
    ],
    expenses: [{ date: '2026-07-12', amount: 25 }],
  });
  assert.equal(result.revenueCents, 10000);
  assert.equal(result.expenseCents, 2500);
  assert.equal(result.profitCents, 7500);
});
