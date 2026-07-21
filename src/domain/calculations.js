import { toCents } from '../shared/money.js';

function roundRate(baseCents, mode, value) {
  const numeric = Number(value) || 0;
  if (mode === 'fixed') return baseCents + toCents(numeric);
  return Math.round(baseCents * (1 + numeric / 100));
}

export function calculateLineItem(item) {
  const quantity = Number(item.quantity ?? item.qty) || 0;
  const baseRateCents = item.baseRateCents ?? toCents(item.rate);
  const clientRateCents = item.clientRateCents ?? (
    item.markupEnabled ? roundRate(baseRateCents, item.markupMode, item.markupValue) : baseRateCents
  );
  return {
    ...item,
    quantity,
    baseRateCents,
    clientRateCents,
    costCents: Math.round(quantity * baseRateCents),
    totalCents: Math.round(quantity * clientRateCents),
  };
}

export function calculateDocumentTotals({ items = [], overheadPercent = 0, taxRate = 0, taxEnabled = false, taxScope = 'all' }) {
  const calculatedItems = items.map(calculateLineItem);
  const subtotalCents = calculatedItems.reduce((sum, item) => sum + item.totalCents, 0);
  const overheadCents = Math.round(subtotalCents * ((Number(overheadPercent) || 0) / 100));
  const taxableSubtotalCents = taxScope === 'materials'
    ? calculatedItems.filter(item => (item.lineType || 'material') === 'material').reduce((sum, item) => sum + item.totalCents, 0)
    : subtotalCents + overheadCents;
  const taxCents = taxEnabled ? Math.round(taxableSubtotalCents * ((Number(taxRate) || 0) / 100)) : 0;
  return { calculatedItems, subtotalCents, overheadCents, taxCents, totalCents: subtotalCents + overheadCents + taxCents };
}

export function calculateProfitAndLoss({ invoices = [], expenses = [], year, month }) {
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const paidInvoices = invoices.filter(invoice => invoice.status === 'Paid' && invoice.date?.startsWith(monthPrefix));
  const monthlyExpenses = expenses.filter(expense => expense.date?.startsWith(monthPrefix));
  const revenueCents = paidInvoices.reduce((sum, invoice) => sum + (invoice.totalCents ?? toCents(invoice.total)), 0);
  const manualExpenseCents = monthlyExpenses.reduce((sum, expense) => sum + (expense.amountCents ?? toCents(expense.amount)), 0);
  const automaticCostCents = paidInvoices.reduce((sum, invoice) => sum + (invoice.items || []).reduce((itemSum, item) => {
    const type = item.lineType || 'material';
    if (!['material', 'sub', 'employee'].includes(type)) return itemSum;
    return itemSum + calculateLineItem(item).costCents;
  }, 0), 0);
  const expenseCents = manualExpenseCents + automaticCostCents;
  return {
    paidInvoices,
    monthlyExpenses,
    revenueCents,
    manualExpenseCents,
    automaticCostCents,
    expenseCents,
    profitCents: revenueCents - expenseCents,
    marginPercent: revenueCents ? ((revenueCents - expenseCents) / revenueCents) * 100 : 0,
  };
}
