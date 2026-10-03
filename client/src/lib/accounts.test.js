import test from 'node:test';
import assert from 'node:assert/strict';
import { interestInfo, earnsInterest } from './accounts.js';

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

test('savings interest: APY gives yearly and monthly earnings', () => {
  const today = new Date(2026, 9, 3);
  const i = interestInfo({ type: 'savings', balance: 10000, apy: 4, balanceAsOf: '2026-10-03' }, today);
  near(i.yearly, 400);
  near(i.monthly, 32.74);
  near(i.estimatedToday, 10000);
});

test('savings interest accrues since the balance date', () => {
  const i = interestInfo({ type: 'savings', balance: 10000, apy: 4, balanceAsOf: '2025-10-03' }, new Date(2026, 9, 3));
  near(i.accruedSinceAsOf, 400, 0.5);
  near(i.estimatedToday, 10400, 0.5);
});

test('CD maturity value', () => {
  const i = interestInfo({ type: 'cd', balance: 5000, apy: 5, balanceAsOf: '2026-01-01', maturityDate: '2027-01-01' }, new Date(2026, 0, 1));
  near(i.maturityValue, 5250, 0.5);
  assert.ok(i.daysToMaturity > 360);
});

test('no interest for credit cards, cash, zero APY or empty balance', () => {
  assert.equal(earnsInterest('credit'), false);
  assert.equal(interestInfo({ type: 'cash', balance: 500, apy: 4 }), null);
  assert.equal(interestInfo({ type: 'savings', balance: 500, apy: 0 }), null);
  assert.equal(interestInfo({ type: 'savings', balance: 0, apy: 4 }), null);
});

import { assetInfo, isAsset, hasTransactions } from './accounts.js';

test('assets: equity after a linked loan, and expected yearly change', () => {
  const accounts = [{ id: 'm', type: 'mortgage', balance: 212000 }, { id: 'h', type: 'home', balance: 350000, appreciation: 3, linkedLoan: 'm' }];
  const i = assetInfo(accounts[1], accounts);
  assert.equal(i.equity, 138000);
  assert.equal(i.owed, 212000);
  assert.equal(i.yearlyChange, 10500);
  const car = assetInfo({ type: 'vehicle', balance: 20000, appreciation: -15 }, accounts);
  assert.equal(car.equity, 20000);
  assert.equal(car.yearlyChange, -3000);
  assert.ok(isAsset('home') && !hasTransactions('vehicle') && hasTransactions('checking'));
});
