import { useMemo, useRef, useState } from 'react';
import { FileUp, ArrowLeftRight, Undo2, CheckCircle2, FileText, Lock } from 'lucide-react';
import { api } from '../api.js';
import { useData } from '../DataContext.jsx';
import { PageHead, Card, Amount, CategorySelect } from '../components/ui.jsx';
import { AccountForm } from './Accounts.jsx';
import { money, shortDate, longDate } from '../lib/format.js';
import { typeLabel, isDebt, hasTransactions } from '../lib/accounts.js';

export default function Import() {
  const { data, mutate, notify, accountsById } = useData();
  const [accountId, setAccountId] = useState(data.accounts.find((a) => hasTransactions(a.type))?.id || '');
  const [preview, setPreview] = useState(null);
  const [rows, setRows] = useState([]);
  const [applyStatement, setApplyStatement] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const [newAccount, setNewAccount] = useState(!data.accounts.length);
  const [ocr, setOcr] = useState(null); // { label, pct } while reading a photo or scan
  const [keepFile, setKeepFile] = useState(true);
  const inputRef = useRef(null);
  const account = accountsById.get(accountId);

  const showPreview = (p) => {
    setPreview(p);
    setRows(p.rows.map((r) => ({ ...r, include: !r.duplicate })));
    setApplyStatement(Object.keys(p.statement || {}).length > 0);
    setKeepFile(!!p.uploadId);
  };

  // Photos and scanned PDFs: read the text in this browser, then let the server find transactions.
  const readWithOcr = async (file) => {
    setOcr({ label: 'Loading the text reader…', pct: 0 });
    const { ocrFile } = await import('../lib/ocr.js'); // loaded only when needed
    const lines = await ocrFile(file, setOcr);
    setOcr({ label: 'Finding transactions…', pct: 100 });
    const form = new FormData();
    form.append('accountId', accountId);
    form.append('fileName', file.name);
    form.append('lines', JSON.stringify(lines));
    form.append('file', file);
    showPreview(await api('/import/preview-text', { method: 'POST', form }));
  };

  const upload = async (file) => {
    if (!file) return;
    if (!accountId) return setError('Choose or create the account this statement belongs to first.');
    setError('');
    setBusy(true);
    try {
      if (/^image\//.test(file.type) || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) {
        await readWithOcr(file);
      } else {
        const form = new FormData();
        form.append('accountId', accountId);
        form.append('file', file);
        try {
          showPreview(await api('/import/preview', { method: 'POST', form }));
        } catch (e) {
          if (e.status !== 422) throw e;
          await readWithOcr(file); // scanned PDF with no text layer
        }
      }
    } catch (e) {
      setError(e.message || 'Could not read this file');
    } finally {
      setBusy(false);
      setOcr(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const flipAll = () => setRows((rs) => rs.map((r) => ({ ...r, amount: -r.amount })));
  const included = rows.filter((r) => r.include);
  const totals = useMemo(() => included.reduce((s, r) => {
    if (r.amount > 0) s.in += r.amount; else s.out -= r.amount;
    return s;
  }, { in: 0, out: 0 }), [included]);

  const commit = async () => {
    setBusy(true);
    try {
      const res = await mutate('/import/commit', {
        method: 'POST',
        body: {
          accountId,
          fileName: preview.fileName,
          rows: included.map(({ date, description, amount, category }) => ({ date, description, amount, category })),
          statement: applyStatement ? preview.statement : null,
          uploadId: preview.uploadId,
          keepFile: keepFile && !!preview.uploadId,
        },
      });
      notify(`Imported ${res.count} transactions`);
      setPreview(null);
      setRows([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const st = preview?.statement || {};
  const hasStatement = Object.keys(st).length > 0;
  const dupes = rows.filter((r) => r.duplicate).length;

  return (
    <>
      <PageHead title="Import statements" subtitle="CSV, OFX/QFX or PDF from your bank or card issuer. Files are read in memory and never saved unencrypted." />

      {!preview && (
        <div className="grid g-3-1">
          <Card title="1. Which account is this statement for?">
            {newAccount ? (
              <AccountForm
                onSaved={(a) => { setAccountId(a.id); setNewAccount(false); }}
                onCancel={data.accounts.length ? () => setNewAccount(false) : undefined}
                submitLabel="Create account"
              />
            ) : (
              <div className="row">
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ flex: 1 }} aria-label="Account">
                  {data.accounts.filter((a) => hasTransactions(a.type)).map((a) => <option key={a.id} value={a.id}>{a.name} ({typeLabel(a.type, true)})</option>)}
                </select>
                <button className="btn" onClick={() => setNewAccount(true)}>New account</button>
              </div>
            )}

            <h2 className="mt" style={{ marginTop: 22, marginBottom: 12 }}>2. Upload the statement</h2>
            <label
              className={`dropzone${over ? ' over' : ''}`}
              style={{ display: 'block', opacity: accountId ? 1 : 0.5 }}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files[0]); }}
            >
              <FileUp size={30} strokeWidth={1.6} style={{ color: 'var(--accent)' }} />
              <div style={{ fontWeight: 600, marginTop: 8 }}>{ocr ? ocr.label : busy ? 'Reading statement…' : 'Drop a file here or click to browse'}</div>
              {ocr ? (
                <div className="bar" style={{ maxWidth: 320, margin: '12px auto 0' }}><span style={{ width: `${ocr.pct}%` }} /></div>
              ) : (
                <div className="faint" style={{ marginTop: 4 }}>.csv · .ofx · .qfx · .pdf · photos (.jpg, .png) — up to 15 MB</div>
              )}
              <input ref={inputRef} type="file" accept=".csv,.txt,.ofx,.qfx,.qbo,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif,image/*" hidden disabled={!accountId || busy} onChange={(e) => upload(e.target.files[0])} />
            </label>
            {error && <div className="error-box mt" role="alert">{error}</div>}
          </Card>

          <Card title="Tips">
            <div className="stack" style={{ gap: 12, fontSize: 13.5 }} >
              <p><b>Best: CSV or OFX/QFX.</b> In your bank’s website look for “Download transactions” or “Export”. These import perfectly.</p>
              <p><b>PDF statements</b> work for most text-based statements and also pick up the card balance, minimum payment and APR. Always check the preview.</p>
              <p><b>Photos and scanned statements</b> are read with OCR right in your browser, on this computer. Use a flat, well-lit, straight-on photo. OCR can misread numbers, so check every row.</p>
              <p><b>Statement copies</b> can be kept encrypted with your password. If the password is forgotten, they can’t be opened by anyone.</p>
              <p><b>Duplicates</b> are detected automatically, so overlapping date ranges are safe to import.</p>
              <p className="muted">Money out is shown as negative, money in as positive. If a file comes in backwards, use <i>Flip signs</i>.</p>
            </div>
          </Card>
        </div>
      )}

      {preview && (
        <div className="stack">
          <Card title={<span className="row" style={{ gap: 8 }}><FileText size={18} /> {preview.fileName}</span>}
            subtitle={`${preview.format === 'ocr' ? 'Read with OCR' : preview.format.toUpperCase()} · ${rows.length} rows found · importing into ${account?.name}`}
            action={<div className="row">
              <button className="btn" onClick={() => { setPreview(null); setRows([]); }}>Cancel</button>
              <button className="btn primary" onClick={commit} disabled={busy || !included.length}><CheckCircle2 size={16} /> Import {included.length}</button>
            </div>}>
            <div className="stack" style={{ gap: 10 }}>
              {preview.warnings.map((w) => <div key={w} className="warn-box">{w}</div>)}
              {dupes > 0 && <div className="info-box">{dupes} row{dupes === 1 ? ' looks' : 's look'} already imported and {dupes === 1 ? 'was' : 'were'} unchecked.</div>}
              {preview.uploadId && (
                <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={keepFile} onChange={(e) => setKeepFile(e.target.checked)} />
                  <Lock size={14} />
                  <span>Keep an encrypted copy of this statement <span className="faint">(only your password can open it; if the password is lost, so is the copy)</span></span>
                </label>
              )}
              {hasStatement && (
                <label className="info-box row" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={applyStatement} onChange={(e) => setApplyStatement(e.target.checked)} />
                  <span>Update <b>{account?.name}</b> from this statement:
                    {st.balance != null && <> balance <b>{money(isDebt(account?.type) ? Math.abs(st.balance) : st.balance)}</b></>}
                    {st.minPayment != null && <> · minimum payment <b>{money(st.minPayment)}</b></>}
                    {st.apr != null && <> · APR <b>{st.apr}%</b></>}
                    {st.creditLimit != null && <> · limit <b>{money(st.creditLimit)}</b></>}
                    {st.dueDate && <> · due <b>{longDate(st.dueDate)}</b></>}
                  </span>
                </label>
              )}
              <div className="spread">
                <div className="row" style={{ gap: 16 }}>
                  <span>In <b className="pos num">{money(totals.in)}</b></span>
                  <span>Out <b className="num">{money(totals.out)}</b></span>
                </div>
                <button className="btn sm" onClick={flipAll}><ArrowLeftRight size={14} /> Flip signs</button>
              </div>
            </div>
          </Card>

          <Card className="flush">
            <div className="table-wrap" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input type="checkbox" aria-label="Select all" checked={included.length === rows.length}
                        onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, include: e.target.checked })))} />
                    </th>
                    <th>Date</th><th>Description</th><th>Category</th><th className="amount">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.key} className={r.include ? '' : 'dim'}>
                      <td><input type="checkbox" checked={r.include} aria-label="Include row"
                        onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} /></td>
                      <td className="faint" style={{ whiteSpace: 'nowrap' }}>{shortDate(r.date)} {r.date.slice(0, 4)}</td>
                      <td className="desc">{r.description} {r.duplicate && <span className="badge warn">Duplicate</span>}</td>
                      <td><CategorySelect className="inline" categories={data.categories} value={r.category}
                        onChange={(c) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, category: c } : x)))} /></td>
                      <td className="amount">
                        <button className="btn ghost sm" title="Flip sign" onClick={() => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, amount: -x.amount } : x)))}>
                          <Amount value={r.amount} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {!preview && data.imports.length > 0 && (
        <Card className="mt flush" title="Import history">
          <div className="table-wrap">
            <table>
              <thead><tr><th>File</th><th>Account</th><th>Covers</th><th>Imported</th><th className="amount">Rows</th><th /></tr></thead>
              <tbody>
                {[...data.imports].reverse().map((imp) => (
                  <tr key={imp.id}>
                    <td className="desc">
                      {imp.file
                        ? <a href={`/api/imports/${imp.id}/file`} download title="Download the encrypted copy (decrypted for you)"><Lock size={12} /> {imp.fileName}</a>
                        : imp.fileName}
                    </td>
                    <td className="muted">{accountsById.get(imp.accountId)?.name}</td>
                    <td className="faint">{imp.from ? `${longDate(imp.from)} – ${longDate(imp.to)}` : '—'}</td>
                    <td className="faint">{new Date(imp.importedAt).toLocaleDateString()}</td>
                    <td className="amount">{imp.count}</td>
                    <td style={{ width: 90 }}>
                      <button className="btn ghost sm" onClick={() => confirm(`Remove the ${imp.count} transactions from this import?`) &&
                        mutate(`/imports/${imp.id}`, { method: 'DELETE' }, 'Import undone')}>
                        <Undo2 size={14} /> Undo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
