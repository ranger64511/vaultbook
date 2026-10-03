import test from 'node:test';
import assert from 'node:assert/strict';
import { simulatePayoff, detectRecurring } from './analytics.js';

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
