import test from 'node:test';
import assert from 'node:assert/strict';
import { toSimExtras, towardDebt, describeAdjustment } from './payoff.js';

const today = '2026-10';

test('a one-time lump becomes a single extra', () => {
  const x = toSimExtras([{ type: 'lump', amount: 1000, month: '2027-01' }], today);
  assert.deepEqual(x, [{ type: 'lump', start: 3, amount: 1000, target: null }]);
});

test('repeating bonuses: monthly, quarterly, yearly with an end month', () => {
  const monthly = toSimExtras([{ type: 'lump', amount: 500, month: '2026-11', repeat: 'monthly', endMonth: '2027-04' }], today);
  assert.deepEqual(monthly.map((e) => e.start), [1, 2, 3, 4, 5, 6]);
  const quarterly = toSimExtras([{ type: 'lump', amount: 500, month: '2026-11', repeat: 'quarterly', endMonth: '2027-11' }], today);
  assert.deepEqual(quarterly.map((e) => e.start), [1, 4, 7, 10, 13]);
  const yearly = toSimExtras([{ type: 'lump', amount: 5000, month: '2027-03', repeat: 'yearly' }], today, 40);
  assert.deepEqual(yearly.map((e) => e.start), [5, 17, 29]);
});

test('a bonus that started in the past only counts future occurrences', () => {
  const x = toSimExtras([{ type: 'lump', amount: 300, month: '2026-07', repeat: 'monthly', endMonth: '2026-12' }], today);
  assert.deepEqual(x.map((e) => e.start), [1, 2]);
});

test('percent toward debt scales the amount', () => {
  assert.equal(towardDebt({ amount: 2000, percent: 50 }), 1000);
  assert.equal(towardDebt({ amount: 2000 }), 2000);
  const [e] = toSimExtras([{ type: 'increase', amount: 400, percent: 25, month: '2027-06' }], today);
  assert.deepEqual(e, { type: 'increase', start: 8, end: null, amount: 100 });
});

test('mid-year raise is described with its start month', () => {
  const d = describeAdjustment({ type: 'increase', source: 'raise', amount: 300, month: '2027-06' }, () => '');
  assert.match(d, /^Raise: \+\$300\/month from June 2027$/);
  const b = describeAdjustment({ type: 'lump', source: 'bonus', amount: 1200, percent: 50, month: '2026-12', repeat: 'quarterly' }, () => '');
  assert.match(b, /Bonus: \$1,200 every 3 months from December 2026 \(50% → \$600 toward debt\)/);
});
