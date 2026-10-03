import { parseCsv } from './csv.js';
import { parseOfx } from './ofx.js';
import { parsePdf } from './pdf.js';
import { suggestFlip } from './common.js';

export async function parseStatement(fileName, buffer, accountType) {
  const name = fileName.toLowerCase();
  const head = buffer.subarray(0, 1024).toString('latin1');
  let result;
  if (name.endsWith('.pdf') || head.startsWith('%PDF')) {
    result = await parsePdf(buffer, accountType);
  } else if (/\.(ofx|qfx|qbo)$/.test(name) || /OFXHEADER|<OFX>/i.test(head)) {
    result = parseOfx(buffer.toString('utf8'));
  } else if (/\.(csv|txt)$/.test(name)) {
    result = parseCsv(buffer.toString('utf8'));
  } else {
    throw new Error('Unsupported file type. Use CSV, OFX/QFX, or PDF.');
  }
  result.flip = result.signConvention === 'standard' ? false : suggestFlip(result.rows, accountType);
  return result;
}
