// Optical character recognition for photos and scanned statements.
// Everything runs in this browser tab; the OCR engine and English language data are
// served by the local Vault Book server, so nothing is sent to the internet.
import { createWorker } from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_PDF_PAGES = 20;
let workerPromise = null;
let progressHandler = null;

function getWorker() {
  workerPromise ??= createWorker('eng', 1, {
    workerPath: '/ocr/worker/worker.min.js',
    corePath: '/ocr/core',
    langPath: '/ocr/lang',
    workerBlobURL: false,
    gzip: true,
    logger: (m) => progressHandler?.(m),
  }).catch((e) => { workerPromise = null; throw e; });
  return workerPromise;
}

export const isImage = (file) => /^image\/(png|jpe?g|webp|bmp|gif)$/i.test(file.type) || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name);

async function readImage(worker, image) {
  const { data } = await worker.recognize(image);
  return data.text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * Reads text lines from an image or a scanned PDF.
 * onProgress({ label, pct }) is called as work proceeds (pct 0-100).
 */
export async function ocrFile(file, onProgress = () => {}) {
  onProgress({ label: 'Starting the text reader…', pct: 0 });
  const worker = await getWorker();
  if (isImage(file)) {
    progressHandler = (m) => m.status === 'recognizing text' && onProgress({ label: 'Reading the photo…', pct: Math.round(m.progress * 100) });
    try { return await readImage(worker, file); } finally { progressHandler = null; }
  }

  // Scanned PDF: draw each page in the browser, then read it.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
  const lines = [];
  try {
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 2.5 }); // ~180 dpi: a good balance of accuracy and speed
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      progressHandler = (m) => m.status === 'recognizing text'
        && onProgress({ label: `Reading page ${p} of ${pages}…`, pct: Math.round(((p - 1 + m.progress) / pages) * 100) });
      lines.push(...await readImage(worker, canvas));
      canvas.width = 0; // free memory
      canvas.height = 0;
    }
  } finally {
    progressHandler = null;
    await doc.destroy();
  }
  if (doc.numPages > MAX_PDF_PAGES) lines.push(`(Only the first ${MAX_PDF_PAGES} pages were read.)`);
  return lines;
}
