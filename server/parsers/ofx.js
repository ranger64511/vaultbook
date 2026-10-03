import { parseAmount, parseDate, cleanDescription } from './common.js';

// OFX/QFX files (Quicken/Money downloads) are SGML-ish: tags may not be closed.
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : null;
};

export function parseOfx(text) {
  const rows = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const date = parseDate(tag(block, 'DTPOSTED') || tag(block, 'DTUSER'));
    const amount = parseAmount(tag(block, 'TRNAMT'));
    if (!date || amount == null) continue;
    const name = tag(block, 'NAME') || '';
    const memo = tag(block, 'MEMO') || '';
    const description = cleanDescription(memo && !name.includes(memo) ? `${name} ${memo}` : name || memo);
    rows.push({ date, description, amount, fitid: tag(block, 'FITID') });
  }
  const statement = {};
  const ledger = text.match(/<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|$)/i);
  if (ledger) {
    const bal = parseAmount(tag(ledger[1], 'BALAMT'));
    if (bal != null) statement.balance = bal;
  }
  const isCredit = /<CCSTMTRS>/i.test(text);
  return {
    format: 'ofx',
    rows,
    warnings: rows.length ? [] : ['No transactions found in this file.'],
    statement,
    accountTypeHint: isCredit ? 'credit' : undefined,
    // OFX convention is already "negative = money out" for both banks and cards.
    signConvention: 'standard',
  };
}
