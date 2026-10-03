import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatement } from './parsers/index.js';
import { parseStatementLines } from './parsers/pdf.js';

/** Builds a tiny one-page text PDF so the parser can be tested without real statements. */
function makePdf(lines) {
  const esc = (s) => s.replace(/[()\\]/g, (m) => `\\${m}`);
  const content = `BT /F1 11 Tf 50 760 Td 14 TL\n${lines.map((l) => `(${esc(l)}) Tj T*`).join('\n')}\nET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n';
  const off = [];
  objs.forEach((o, i) => { off.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

test('text PDF credit card statement: transactions and statement details', async () => {
  const pdf = makePdf(['ACME BANK VISA STATEMENT', 'Opening/Closing Date 08/16/26 - 09/15/26', 'New Balance: $2,345.67',
    'Minimum Payment Due: $58.00', 'Payment Due Date: 10/10/26', 'Credit Limit: $5,000', '08/20 PAYMENT THANK YOU -400.00',
    '08/17 NETFLIX.COM 15.49', '08/25 KROGER #442 87.12', 'Purchases 24.99% (v)']);
  const r = await parseStatement('s.pdf', pdf, 'credit');
  assert.equal(r.format, 'pdf');
  assert.deepEqual(r.rows.map((x) => [x.date, x.amount]), [['2026-08-20', 400], ['2026-08-17', -15.49], ['2026-08-25', -87.12]]);
  assert.deepEqual(r.statement, { balance: 2345.67, minPayment: 58, creditLimit: 5000, apr: 24.99, dueDate: '2026-10-10' });
});

test('a PDF with no text asks for OCR', async () => {
  await assert.rejects(parseStatement('scan.pdf', makePdf(['']), 'credit'), (e) => e.code === 'NEEDS_OCR');
});

test('OCR lines: spacing slips in amounts and dates are cleaned up', () => {
  const r = parseStatementLines(['Closing Date 09/15/26', 'New Balance: $ 2, 345 .67', '08/17 NETFLIX.COM 15 .49', '08 / 25 KROGER #442 87.12'], 'credit', 'ocr');
  assert.equal(r.format, 'ocr');
  assert.deepEqual(r.rows.map((x) => [x.date, x.description, x.amount]), [['2026-08-17', 'NETFLIX.COM', -15.49], ['2026-08-25', 'KROGER #442', -87.12]]);
  assert.equal(r.statement.balance, 2345.67);
});
