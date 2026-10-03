import test from 'node:test';
import assert from 'node:assert/strict';
import { categorize, merchantKey, DEFAULT_RULES } from './categorize.js';
import { parseAmount, parseDate } from './parsers/common.js';

test('categorizes common bank descriptions', () => {
  const cases = {
    'INTERNET PAYMENT - THANK YOU': 'cc-payment',
    'Payment Thank You-Mobile': 'cc-payment',
    'CHASE CREDIT CRD AUTOPAY': 'cc-payment',
    'CAPITAL ONE MOBILE PYMT': 'cc-payment',
    'DISCOVER E-PAYMENT': 'cc-payment',
    'EXXONMOBIL 4471': 'gas',
    'T-MOBILE AUTOPAY': 'phone-internet',
    'ZELLE PAYMENT TO OAKWOOD APTS RENT': 'housing',
    'ZELLE TO JOHN SMITH': 'transfer',
    'NETFLIX.COM': 'subscriptions',
    'UBER EATS': 'dining',
    'UBER TRIP': 'transportation',
    'ACME CORP PAYROLL DIRECT DEP': 'income',
    'PURCHASE INTEREST CHARGE': 'fees',
  };
  for (const [desc, want] of Object.entries(cases)) {
    assert.equal(categorize(desc, -1, DEFAULT_RULES, 'checking'), want, desc);
  }
});

test('unmatched card credits are refunds, not income', () => {
  assert.equal(categorize('MYSTERY CREDIT', 20, DEFAULT_RULES, 'credit'), 'uncategorized');
  assert.equal(categorize('MYSTERY CREDIT', 20, DEFAULT_RULES, 'checking'), 'income');
});

test('merchant keys strip store numbers and noise', () => {
  assert.equal(merchantKey('POS PURCHASE NETFLIX.COM 866-579-7172 CA #1234'), 'NETFLIX.COM');
  assert.equal(merchantKey('KROGER #442'), 'KROGER');
  assert.equal(merchantKey('HULU 877-8244858'), 'HULU');
});

test('parses amounts and dates', () => {
  assert.equal(parseAmount('$1,234.56'), 1234.56);
  assert.equal(parseAmount('(12.00)'), -12);
  assert.equal(parseAmount('45.10 CR'), -45.1);
  assert.equal(parseDate('09/05/26'), '2026-09-05');
  assert.equal(parseDate('2026-09-05'), '2026-09-05');
  assert.equal(parseDate('09/05', 2025), '2025-09-05');
  assert.equal(parseDate('Sep 5, 2026'), '2026-09-05');
});
