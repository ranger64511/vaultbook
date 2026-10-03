import Papa from 'papaparse';
import { parseAmount, parseDate, cleanDescription } from './common.js';

const find = (headers, ...patterns) => {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h));
    if (i !== -1) return i;
  }
  return -1;
};

/** Parses a bank/credit-card CSV export, auto-detecting the columns. */
export function parseCsv(text) {
  const { data } = Papa.parse(text.replace(/^﻿/, ''), { skipEmptyLines: true });
  const warnings = [];

  // Some banks put account info above the real header row.
  let headerRow = data.findIndex((row) => row.some((c) => /date/i.test(c)) &&
    row.some((c) => /amount|debit|credit|withdrawal|deposit/i.test(c)));
  let headers;
  if (headerRow === -1) {
    // Headerless file (e.g. Wells Fargo): date, amount, *, *, description
    headerRow = -1;
    headers = data[0].map((_, i) => `col${i}`);
    warnings.push('No header row found - guessed columns from the data.');
  } else {
    headers = data[headerRow].map((h) => String(h).trim().toLowerCase());
  }
  const body = data.slice(headerRow + 1);

  let iDate, iDesc, iAmt, iDebit, iCredit, iType, iCat, iMemo;
  if (headerRow === -1) {
    const sample = body[0] || [];
    iDate = sample.findIndex((c) => parseDate(c));
    iAmt = sample.findIndex((c, i) => i !== iDate && parseAmount(c) != null && /\./.test(c));
    iDesc = sample.reduce((best, c, i) => (String(c).length > String(sample[best] ?? '').length && i !== iDate && i !== iAmt ? i : best), 0);
  } else {
    iDate = find(headers, /^(transaction|trans\.?|txn)\s*date$/, /^date$/, /^posted?(ing)?\s*date$/, /date/);
    iDesc = find(headers, /^description$/, /^(payee|merchant|merchant name|name)$/, /description|payee|merchant|details|narrative/, /^memo$/);
    iAmt = find(headers, /^amount$/, /^(transaction )?amount\b/, /amount/);
    iDebit = find(headers, /^debit|withdrawal|^charges?$|money out/);
    iCredit = find(headers, /^credit|deposit|^payments?$|money in/);
    iType = find(headers, /^(type|transaction type|details)$/);
    iCat = find(headers, /^category$/);
    iMemo = headers.findIndex((h, i) => /^memo$/.test(h) && i !== iDesc);
  }
  if (iDate === -1 || iDesc === -1 || (iAmt === -1 && iDebit === -1 && iCredit === -1)) {
    throw new Error('Could not find date / description / amount columns in this CSV.');
  }

  const rows = [];
  for (const r of body) {
    const date = parseDate(r[iDate]);
    if (!date) continue;
    let amount;
    if (iAmt !== -1 && r[iAmt] !== '' && r[iAmt] != null) {
      amount = parseAmount(r[iAmt]);
      // Some banks use a type column ("DEBIT"/"CREDIT") with unsigned amounts.
      if (amount > 0 && iType !== -1 && /^debit$/i.test(String(r[iType]).trim())) amount = -amount;
    } else {
      const debit = iDebit !== -1 ? Math.abs(parseAmount(r[iDebit]) || 0) : 0;
      const credit = iCredit !== -1 ? Math.abs(parseAmount(r[iCredit]) || 0) : 0;
      amount = Math.round((credit - debit) * 100) / 100;
    }
    if (amount == null || Number.isNaN(amount)) continue;
    let description = cleanDescription(r[iDesc]);
    if (iMemo !== -1 && r[iMemo] && !description.includes(r[iMemo])) description += ` ${cleanDescription(r[iMemo])}`;
    rows.push({ date, description, amount, bankCategory: iCat !== -1 ? r[iCat] : undefined });
  }
  if (!rows.length) warnings.push('No transactions found in this file.');
  return { format: 'csv', rows, warnings, statement: {} };
}
