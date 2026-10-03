import test from 'node:test';
import assert from 'node:assert/strict';
import { simulatePayoff, detectRecurring, projectPlannedSavings } from './analytics.js';

const debts = [
  { id: 'a', name: 'High APR', balance: 2000, apr: 29.99, minPayment: 60 },
  { id: 'b', name: 'Small', balance: 500, apr: 15, minPayment: 25 },
];

test('payoff: avalanche pays less interest than snowball and both beat minimums', () => {
  const av = simulatePayoff(debts, 400, 'avalanche');
  const sb = simulatePayoff(debts, 400, 'snowball');
  const min = simulatePayoff(debts, 0, 'minimum');
  assert.ok(Number.isFinite(av.months) && av.months < 12);
  assert.ok(av.totalInterest <= sb.totalInterest);
  assert.ok(min.months > av.months && min.totalInterest > av.totalInterest);
  assert.equal(av.order[0], 'a'); // avalanche clears the highest APR first
  assert.equal(sb.order[0], 'b');
});

test('payoff: never finishes when payments do not cover interest', () => {
  const r = simulatePayoff([{ id: 'x', name: 'X', balance: 10000, apr: 30, minPayment: 100 }], 100, 'avalanche', 240);
  assert.equal(r.months, Infinity);
});

test('recurring: detects a monthly subscription with a stable amount', () => {
  const txs = ['2026-05-04', '2026-06-04', '2026-07-04', '2026-08-04'].map((date, i) => ({
    id: String(i), accountId: 'c', date, amount: -15.49, merchant: 'NETFLIX.COM', description: 'NETFLIX.COM', category: 'subscriptions',
  }));
  const [r] = detectRecurring(txs, [{ id: 'subscriptions', kind: 'want' }]);
  assert.equal(r.frequency, 'monthly');
  assert.equal(r.amount, 15.49);
  assert.ok(Math.abs(r.yearly - 185.88) < 0.5);
});

test('planned savings: monthly charge counts from the stop month on', () => {
  const item = { key: 'N', name: 'Netflix', amount: 15.49, periodDays: 30.44, next: '2026-10-04' };
  const rows = projectPlannedSavings([{ item, stopMonth: '2026-12' }], 12, new Date(2026, 9, 3));
  assert.equal(rows[0].key, '2026-10');
  assert.equal(rows[0].total, 0); // Oct and Nov still charged
  assert.equal(rows[1].total, 0);
  assert.equal(rows[2].total, 15.49); // Dec onward saved
  assert.equal(rows.filter((r) => r.total > 0).length, 10);
});

test('planned savings: a yearly charge shows up only in its renewal month', () => {
  const item = { key: 'A', name: 'Annual', amount: 99, periodDays: 365, next: '2027-03-15' };
  const rows = projectPlannedSavings([{ item, stopMonth: '2026-10' }], 12, new Date(2026, 9, 3));
  assert.deepEqual(rows.filter((r) => r.total > 0).map((r) => r.key), ['2027-03']);
});

test('planned savings: an overdue next date rolls forward', () => {
  const item = { key: 'W', name: 'Weekly', amount: 10, periodDays: 7, next: '2026-09-01' };
  const rows = projectPlannedSavings([{ item, stopMonth: '2026-10' }], 1, new Date(2026, 9, 3));
  assert.ok(rows[0].total >= 40); // 4–5 weekly charges in October
});
