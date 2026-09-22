/*
 * On-device OCR via Tesseract.js (WASM). Reads serial, batch and MRP
 * labels from a captured crop. Production build swaps this for ML Kit
 * Text Recognition v2 with a finetune on IMEI/serial fonts.
 */

let worker = null;
let loading = null;

export function loadOcr() {
  if (!loading) {
    loading = Tesseract.createWorker("eng").then((w) => {
      worker = w;
      return w;
    });
  }
  return loading;
}

export function ocrReady() {
  return worker !== null;
}

/* Recognize text on a canvas and pull out serial-number candidates:
 * runs of 6+ alphanumerics with at least one digit, plus IMEI-shaped
 * 15-digit runs. */
export async function readLabel(canvas) {
  if (!worker) await loadOcr();
  const { data } = await worker.recognize(canvas);
  const raw = (data.text || "").trim();
  const tokens = raw.toUpperCase().match(/[A-Z0-9-]{6,}/g) || [];
  const serialCandidates = tokens.filter((t) => /\d/.test(t.replace(/-/g, "")));
  const imei = (raw.match(/\b\d{15}\b/) || [null])[0];
  return { raw, serialCandidates, imei, confidence: data.confidence };
}
