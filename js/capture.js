/*
 * Truthbox guided capture.
 *
 * Orchestrates the five mandatory steps of a verified unboxing:
 *   1. Seal check   2. Opening   3. Item reveal (detection)
 *   4. Label OCR    5. Sign and seal
 *
 * While the capture runs, every frame is hashed into the chain of
 * custody. At the end a Merkle root over all links is signed with a
 * non-extractable ECDSA P-256 key and exported as a manifest.
 */

import { HashChain, merkleRoot, generateSigningKey, signManifest, sha256, hex } from "./crypto.js";
import { manifestToLink } from "./share.js";
import { loadDetector, detect } from "./detect.js";
import { loadOcr, readLabel } from "./ocr.js";

const $ = (id) => document.getElementById(id);

/* Buyer-facing strings, English and Hindi. The buyer picks a language
 * on the setup screen; evidence and manifests stay English for the
 * seller and dispute side. */
const I18N = {
  en: {
    sealName: "Seal check", sealBanner: "Position the sealed parcel", sealHint: "Show all sides of the tamper seal to the camera.", sealAction: "Seal is intact",
    openName: "Opening", openBanner: "Open the parcel on camera", openHint: "Keep the parcel in frame while you open it. Do not cut away.", openAction: "Parcel is open",
    revealName: "Item reveal", revealBanner: "Show the item to the camera", revealHint: "Hold the item steady in frame. Detection runs on-device.", revealAction: "Waiting for detection...",
    labelName: "Label OCR", labelBanner: "Position the serial label", labelHint: "Fit the serial or MRP label inside the dashed target.", labelAction: "Read label",
    signName: "Sign", signBanner: "Sealing the evidence", signHint: "Computing Merkle root and signing with the device key.", signAction: "Signing...",
    confirmManual: "Confirm item manually", reading: "Reading on-device...", noText: "No text found. Move closer to the label and try again.",
    detected: "Detected: {label} ({pct}%)", matches: " - matches expected SKU class", expected: " - expected {cls}",
    setupTitle: "Verified unboxing", begin: "Begin capture", scanQr: "Scan dispatch QR instead", abort: "Abort",
    modelsLoaded: "On-device models loaded. Nothing you record will leave this phone.",
  },
  hi: {
    sealName: "सील जांच", sealBanner: "सीलबंद पार्सल कैमरे के सामने रखें", sealHint: "टैम्पर सील के सभी किनारे कैमरे को दिखाएं।", sealAction: "सील सही सलामत है",
    openName: "खोलना", openBanner: "पार्सल कैमरे पर खोलें", openHint: "खोलते समय पार्सल फ्रेम में रखें। कैमरा हटाएं नहीं।", openAction: "पार्सल खुल गया है",
    revealName: "सामान", revealBanner: "सामान कैमरे को दिखाएं", revealHint: "सामान को फ्रेम में स्थिर रखें। पहचान डिवाइस पर ही चलती है।", revealAction: "पहचान की प्रतीक्षा...",
    labelName: "लेबल OCR", labelBanner: "सीरियल लेबल दिखाएं", labelHint: "सीरियल या MRP लेबल को डैश वाले बॉक्स में रखें।", labelAction: "लेबल पढ़ें",
    signName: "हस्ताक्षर", signBanner: "सबूत सील किया जा रहा है", signHint: "मर्कल रूट बनाकर डिवाइस की से हस्ताक्षर हो रहा है।", signAction: "हस्ताक्षर हो रहा है...",
    confirmManual: "सामान की पुष्टि खुद करें", reading: "डिवाइस पर पढ़ा जा रहा है...", noText: "कोई टेक्स्ट नहीं मिला। लेबल के पास जाकर दोबारा कोशिश करें।",
    detected: "पहचाना: {label} ({pct}%)", matches: " - अपेक्षित SKU से मेल", expected: " - अपेक्षित: {cls}",
    setupTitle: "सत्यापित अनबॉक्सिंग", begin: "कैप्चर शुरू करें", scanQr: "डिस्पैच QR स्कैन करें", abort: "रद्द करें",
    modelsLoaded: "मॉडल डिवाइस पर लोड हो गए। आपकी कोई रिकॉर्डिंग फोन से बाहर नहीं जाएगी।",
  },
};

let lang = "en";
try { lang = localStorage.getItem("tb-lang") || "en"; } catch {}

function t(key, vars) {
  let s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
  for (const k in vars || {}) s = s.replace("{" + k + "}", vars[k]);
  return s;
}

const STEPS = [
  { id: "seal" }, { id: "open" }, { id: "reveal" }, { id: "label" }, { id: "sign" },
];

const state = {
  step: -1,
  order: null,
  chain: null,
  key: null,
  stream: null,
  recorder: null,
  recordedChunks: [],
  videoBlob: null,
  simulated: false,
  startedAt: null,
  stepLog: [],
  detection: { best: null, hits: 0, done: false },
  calib: { pxPerMm: null, qrMatched: false, samples: 0 },
  measured: null,
  ocr: null,
  hashTimer: null,
  detectTimer: null,
  manifest: null,
  simState: { t: 0 },
};

/* ---------- boot ---------- */

const params = new URLSearchParams(location.search);
$("orderId").value = params.get("order") || "TB-2026-" + String(Math.floor(100000 + Math.random() * 900000));
if (params.get("cls")) $("skuClass").value = params.get("cls");
if (params.get("serial")) $("serialPattern").value = params.get("serial");

function applyLang() {
  document.querySelector("#setup h3").textContent = t("setupTitle");
  $("startBtn").textContent = t("begin");
  $("scanQrBtn").textContent = t("scanQr");
  $("abortBtn").textContent = t("abort");
  if (modelsReady === true) $("modelStatus").textContent = t("modelsLoaded");
  $("langBtn").textContent = lang === "en" ? "हिंदी" : "English";
}

$("langBtn").addEventListener("click", () => {
  lang = lang === "en" ? "hi" : "en";
  try { localStorage.setItem("tb-lang", lang); } catch {}
  applyLang();
  if (state.step >= 0 && state.step < STEPS.length) {
    // Re-label the live UI without re-entering the step (no timer resets).
    const s = STEPS[state.step];
    $("stepName").textContent = t(s.id + "Banner");
    $("stepHint").textContent = t(s.id + "Hint");
    if (!$("actionBtn").disabled) $("actionBtn").textContent = t(s.id + "Action");
    buildStepsRail();
    for (let k = 0; k < STEPS.length; k++) {
      $("rail-" + k).className = "s" + (k < state.step ? " done" : k === state.step ? " active" : "");
    }
  }
});

let modelsReady = false;
applyLang();
Promise.all([loadDetector(), loadOcr()])
  .then(() => {
    modelsReady = true;
    $("modelStatus").textContent = t("modelsLoaded");
  })
  .catch((e) => {
    $("modelStatus").textContent = "Model load failed (" + e.message + "). Capture still runs; detection and OCR will be marked unavailable.";
    modelsReady = "failed";
  });

$("startBtn").addEventListener("click", startCapture);
$("actionBtn").addEventListener("click", onAction);
$("abortBtn").addEventListener("click", () => location.reload());
$("restartBtn").addEventListener("click", () => location.reload());
$("scanQrBtn").addEventListener("click", scanDispatchQr);

/* Scan the Truthbox QR printed on the parcel: decodes the capture URL
 * and binds order id, SKU class, serial pattern and nonce in one shot. */
async function scanDispatchQr() {
  const status = $("qrScanStatus");
  status.style.display = "block";
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } });
  } catch (e) {
    status.textContent = "No camera available for scanning. Enter the order manually.";
    return;
  }
  status.textContent = "Point the camera at the dispatch QR...";
  $("scanQrBtn").disabled = true;
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  await video.play().catch(() => {});
  const c = document.createElement("canvas");
  const stop = () => stream.getTracks().forEach((t) => t.stop());
  const deadline = Date.now() + 30000;
  const tick = () => {
    if (Date.now() > deadline) { stop(); status.textContent = "No QR found in 30 seconds. Enter the order manually."; $("scanQrBtn").disabled = false; return; }
    if (video.readyState >= 2) {
      c.width = video.videoWidth; c.height = video.videoHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      if (qr && qr.data.includes("capture.html?")) {
        stop();
        const p = new URL(qr.data).searchParams;
        if (p.get("order")) $("orderId").value = p.get("order");
        if (p.get("cls")) $("skuClass").value = p.get("cls");
        if (p.get("serial")) $("serialPattern").value = p.get("serial");
        state.scannedParams = p;
        status.textContent = "Order bound from dispatch QR: " + (p.get("order") || "unknown") + ". Begin capture when ready.";
        $("scanQrBtn").disabled = false;
        return;
      }
    }
    requestAnimationFrame(tick);
  };
  tick();
}

/* ---------- capture lifecycle ---------- */

async function startCapture() {
  $("startBtn").disabled = true;
  const p = state.scannedParams || params;
  state.order = {
    id: $("orderId").value.trim() || "TB-UNBOUND",
    nonce: p.get("nonce") || hex(crypto.getRandomValues(new Uint8Array(16))),
    expectedClass: $("skuClass").value,
    serialPattern: $("serialPattern").value.trim() || "[A-Z0-9]{6,}",
    boundVia: state.scannedParams ? "qr-scan" : params.get("nonce") ? "qr-link" : "manual",
    dims: p.get("dimw") ? { wMm: +p.get("dimw"), hMm: +p.get("dimh") || null, tolerancePct: 15 } : null,
    qrMm: +(p.get("qrmm") || 30),
  };

  const video = $("cam");
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 } },
      audio: false,
    });
    video.srcObject = state.stream;
  } catch (e) {
    startSimulation(video);
  }
  await video.play().catch(() => {});

  state.chain = new HashChain();
  state.key = await generateSigningKey();
  state.startedAt = new Date().toISOString();

  try {
    state.recorder = new MediaRecorder(state.stream, { videoBitsPerSecond: 600_000 });
    state.recorder.ondataavailable = (e) => { if (e.data.size) state.recordedChunks.push(e.data); };
    state.recorder.start(1000);
  } catch (e) {
    state.recorder = null;
  }

  $("setup").style.display = "none";
  $("live").style.display = "block";
  if (state.simulated) $("simNote").style.display = "block";
  buildStepsRail();
  enterStep(0);

  // Frame hashing: 5 fps into the chain of custody.
  const off = document.createElement("canvas");
  off.width = 320; off.height = 240;
  const octx = off.getContext("2d", { willReadFrequently: true });
  state.hashTimer = setInterval(async () => {
    if (video.readyState < 2) return;
    octx.drawImage(video, 0, 0, off.width, off.height);
    const bytes = new Uint8Array(octx.getImageData(0, 0, off.width, off.height).data.buffer);
    const link = await state.chain.add(bytes);
    $("frameCount").textContent = state.chain.length + " frames";
    $("chainHead").textContent = link.h.slice(0, 20) + "...";
  }, 200);

  // Detection loop, active from the opening step onward.
  state.detectTimer = setInterval(runDetection, 500);
}

function startSimulation(video) {
  state.simulated = true;
  const c = document.createElement("canvas");
  c.width = 640; c.height = 480;
  const ctx = c.getContext("2d");
  const draw = () => {
    const t = (state.simState.t += 1 / 30);
    ctx.fillStyle = "#1c2430"; ctx.fillRect(0, 0, 640, 480);
    // parcel
    ctx.fillStyle = "#a97c50"; ctx.fillRect(170, 200, 300, 180);
    ctx.fillStyle = "#8a6540"; ctx.fillRect(170, 180, 300, 26);
    // lid opens over time
    const lift = Math.min(120, Math.max(0, (t - 5) * 30));
    ctx.save();
    ctx.translate(170, 190); ctx.rotate((-lift * Math.PI) / 400);
    ctx.fillStyle = "#b58a5c"; ctx.fillRect(0, -16, 300, 18);
    ctx.restore();
    // item emerges after the lid opens
    if (t > 9) {
      const rise = Math.min(90, (t - 9) * 40);
      ctx.fillStyle = "#0e1116";
      ctx.fillRect(245, 250 - rise, 150, 90);
      ctx.strokeStyle = "#3a4656"; ctx.strokeRect(245, 250 - rise, 150, 90);
      ctx.fillStyle = "#e8eef5"; ctx.font = "bold 20px monospace";
      ctx.fillText("SN 84210967", 255, 300 - rise);
    }
    ctx.fillStyle = "#5c6a7d"; ctx.font = "12px monospace";
    ctx.fillText("SIMULATED FEED " + t.toFixed(1) + "s", 12, 20);
    requestAnimationFrame(draw);
  };
  draw();
  state.stream = c.captureStream(15);
  video.srcObject = state.stream;
}

/* ---------- steps ---------- */

function buildStepsRail() {
  $("stepsRail").innerHTML = STEPS.map(
    (s, i) => `<div class="s" id="rail-${i}">${t(s.id + "Name")}</div>`
  ).join("");
}

function enterStep(i) {
  state.step = i;
  if (navigator.vibrate) navigator.vibrate(i === STEPS.length - 1 ? [40, 60, 40] : 30);
  const s = STEPS[i];
  $("stepName").textContent = t(s.id + "Banner");
  $("stepHint").textContent = t(s.id + "Hint");
  $("actionBtn").textContent = t(s.id + "Action");
  $("ocrTarget").style.display = s.id === "label" ? "block" : "none";
  for (let k = 0; k < STEPS.length; k++) {
    const el = $("rail-" + k);
    el.className = "s" + (k < i ? " done" : k === i ? " active" : "");
  }
  // Minimum dwell time per step: no step can be skipped instantly.
  $("actionBtn").disabled = true;
  const dwell = s.id === "reveal" ? 0 : 2500;
  if (s.id === "reveal") {
    // Advances automatically on detection; manual confirm unlocks as a
    // fallback. If detection is unavailable, offer it quickly so the
    // buyer is never stuck waiting on a model that will not answer.
    const fallbackMs = modelsReady === true ? 15000 : 3000;
    setTimeout(() => {
      if (state.step === 2 && !state.detection.done) {
        $("actionBtn").textContent = t("confirmManual");
        $("actionBtn").disabled = false;
      }
    }, fallbackMs);
  } else if (s.id !== "sign") {
    setTimeout(() => { if (state.step === i) $("actionBtn").disabled = false; }, dwell);
  }
  if (s.id === "sign") finalize();
}

async function onAction() {
  const s = STEPS[state.step];
  if (s.id === "seal") {
    snapshot("seal");
    logStep("seal", { confirmedBy: "buyer", frame: state.chain.length });
    enterStep(1);
  } else if (s.id === "open") {
    logStep("open", { confirmedBy: "buyer", frame: state.chain.length });
    enterStep(2);
  } else if (s.id === "reveal") {
    // Manual fallback after detection timeout: recorded as such, not hidden.
    snapshot("reveal");
    logStep("reveal", { confirmedBy: "buyer-manual", detection: state.detection.best, frame: state.chain.length });
    state.detection.done = true;
    enterStep(3);
  } else if (s.id === "label") {
    snapshot("label");
    await doOcr();
  }
}

function logStep(id, evidence) {
  state.stepLog.push({ id, at: new Date().toISOString(), evidence });
}

/* Still-frame evidence: a small JPEG captured at the decisive moment of
 * a step, embedded in the manifest and covered by the signature. */
function snapshot(name) {
  const video = $("cam");
  if (video.readyState < 2 || !video.videoWidth) return;
  const c = document.createElement("canvas");
  const w = 480, h = Math.round((video.videoHeight / video.videoWidth) * w);
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(video, 0, 0, w, h);
  if (!state.snapshots) state.snapshots = {};
  state.snapshots[name] = c.toDataURL("image/jpeg", 0.55);
}

/* ---------- detection ---------- */

/* Planar dimension calibration: the dispatch QR has a known printed
 * size (order.qrMm). When jsQR locates it in frame, its corner-to-corner
 * pixel distance gives a px-per-mm scale, applied to the detection box.
 * Valid while QR and item sit at a similar distance from the camera;
 * the production Android build replaces this with ARCore Depth. */
function calibrate(video) {
  if (typeof jsQR === "undefined") return;
  const c = calibrate.c || (calibrate.c = document.createElement("canvas"));
  const scale = 0.5;
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
  if (!qr) return;
  const { topLeftCorner: a, topRightCorner: b } = qr.location;
  const sidePx = Math.hypot(b.x - a.x, b.y - a.y) / scale; // in video pixels
  if (sidePx < 8) return;
  state.calib.pxPerMm = sidePx / state.order.qrMm;
  state.calib.samples++;
  if (qr.data.includes(state.order.nonce) && !state.calib.qrMatched) {
    state.calib.qrMatched = true;
    document.querySelector(".chainticker .rec").innerHTML = '<span class="dot"></span>QR BOUND';
  }
}

async function runDetection() {
  if (state.step < 1 || state.step > 3) return;
  const video = $("cam");
  if (video.readyState < 2 || modelsReady !== true) return;
  if (state.step >= 2) try { calibrate(video); } catch {}
  let preds = [];
  try { preds = await detect(video); } catch { return; }
  if (state.step === 2 && preds[0] && state.calib.pxPerMm) {
    const [, , w, h] = preds[0].box;
    state.measured = {
      wMm: Math.round(w / state.calib.pxPerMm),
      hMm: Math.round(h / state.calib.pxPerMm),
      calibSamples: state.calib.samples,
      method: "planar-qr",
    };
  }
  drawOverlay(preds);
  if (state.step !== 2 || state.detection.done) return;

  const top = preds[0];
  if (!top) { state.detection.hits = 0; return; }
  if (!state.detection.best || top.score > state.detection.best.score) {
    state.detection.best = { label: top.label, score: +top.score.toFixed(3) };
  }
  const match = top.label === state.order.expectedClass;
  $("liveStatus").textContent =
    t("detected", { label: top.label, pct: Math.round(top.score * 100) }) +
    (match ? t("matches") : t("expected", { cls: state.order.expectedClass }));
  state.detection.hits = match ? state.detection.hits + 1 : 0;
  if (state.detection.hits >= 2) {
    state.detection.done = true;
    snapshot("reveal");
    logStep("reveal", { confirmedBy: "detector", detection: { label: top.label, score: +top.score.toFixed(3) }, frame: state.chain.length });
    enterStep(3);
  }
}

function drawOverlay(preds) {
  const video = $("cam");
  const canvas = $("overlay");
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) return;
  canvas.width = vw; canvas.height = vh;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, vw, vh);
  for (const p of preds) {
    const [x, y, w, h] = p.box;
    const match = p.label === state.order.expectedClass;
    ctx.strokeStyle = match ? "#27d17f" : "#ffb347";
    ctx.lineWidth = Math.max(2, vw / 320);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = match ? "#27d17f" : "#ffb347";
    const label = `${p.label} ${Math.round(p.score * 100)}%`;
    ctx.font = `bold ${Math.max(13, vw / 45)}px monospace`;
    const tw = ctx.measureText(label).width + 10;
    ctx.fillRect(x, Math.max(0, y - 24), tw, 24);
    ctx.fillStyle = "#06130c";
    ctx.fillText(label, x + 5, Math.max(16, y - 6));
    if (p === preds[0] && state.measured) {
      const dim = `~${state.measured.wMm} x ${state.measured.hMm} mm`;
      ctx.fillStyle = "rgba(18, 18, 16, 0.85)";
      const dw = ctx.measureText(dim).width + 10;
      ctx.fillRect(x, y + h + 4, dw, 24);
      ctx.fillStyle = "#3fbf7f";
      ctx.fillText(dim, x + 5, y + h + 21);
    }
  }
}

/* ---------- OCR ---------- */

async function doOcr() {
  const video = $("cam");
  $("actionBtn").disabled = true;
  $("actionBtn").textContent = t("reading");
  const vw = video.videoWidth, vh = video.videoHeight;
  // Crop matches the dashed target: middle band of the frame.
  const crop = document.createElement("canvas");
  const cw = Math.round(vw * 0.7), ch = Math.round(vh * 0.24);
  crop.width = cw; crop.height = ch;
  crop.getContext("2d").drawImage(video, vw * 0.15, vh * 0.38, cw, ch, 0, 0, cw, ch);

  let result = { raw: "", serialCandidates: [], imei: null, confidence: 0 };
  if (modelsReady === true) {
    try { result = await readLabel(crop); } catch (e) { /* keep empty result */ }
  }
  const re = new RegExp(state.order.serialPattern);
  const matched = result.serialCandidates.find((s) => re.test(s)) || null;
  state.ocr = { ...result, matchedSerial: matched };

  if (!result.raw && !state.simulated) {
    $("liveStatus").textContent = t("noText");
    $("actionBtn").textContent = t("labelAction");
    $("actionBtn").disabled = false;
    if (!state.ocrRetries) state.ocrRetries = 0;
    if (++state.ocrRetries < 3) return; // after 3 attempts, proceed with empty OCR
  }
  logStep("label", { ocr: { serialCandidates: result.serialCandidates, matchedSerial: matched, confidence: result.confidence }, frame: state.chain.length });
  enterStep(4);
}

/* ---------- finalize and sign ---------- */

async function finalize() {
  clearInterval(state.hashTimer);
  clearInterval(state.detectTimer);
  $("actionBtn").disabled = true;

  if (state.recorder && state.recorder.state !== "inactive") {
    await new Promise((res) => { state.recorder.onstop = res; state.recorder.stop(); });
    const blob = new Blob(state.recordedChunks, { type: state.recordedChunks[0]?.type || "video/webm" });
    if (blob.size > 0) state.videoBlob = blob;
  }

  const links = state.chain.links;
  const root = await merkleRoot(links.map((l) => l.h));
  let videoInfo = null;
  if (state.videoBlob) {
    const vh = await sha256(new Uint8Array(await state.videoBlob.arrayBuffer()));
    videoInfo = { sha256: hex(vh), bytes: state.videoBlob.size, type: state.videoBlob.type };
  }

  const re = new RegExp(state.order.serialPattern);
  let dimensionCheck = "unknown";
  if (state.order.dims && state.measured) {
    const tol = state.order.dims.tolerancePct / 100;
    const within = (got, want) => want == null || Math.abs(got - want) <= want * tol;
    // The box orientation is arbitrary: accept either axis assignment.
    const a = within(state.measured.wMm, state.order.dims.wMm) && within(state.measured.hMm, state.order.dims.hMm);
    const b = within(state.measured.hMm, state.order.dims.wMm) && within(state.measured.wMm, state.order.dims.hMm);
    dimensionCheck = a || b ? "pass" : "fail";
  }
  const verdict = {
    sealConfirmed: state.stepLog.some((s) => s.id === "seal"),
    skuMatch: state.detection.best ? state.detection.best.label === state.order.expectedClass : false,
    detectedAs: state.detection.best,
    serialMatch: !!(state.ocr && state.ocr.matchedSerial && re.test(state.ocr.matchedSerial)),
    serial: state.ocr ? state.ocr.matchedSerial : null,
    dimensionCheck,
    measuredMm: state.measured,
    qrSeenDuringCapture: state.calib.qrMatched,
    simulatedFeed: state.simulated,
  };
  verdict.overall =
    verdict.sealConfirmed && verdict.skuMatch && verdict.serialMatch && dimensionCheck !== "fail"
      ? "VERIFIED" : "FLAGGED";

  const snapshots = {};
  for (const [name, jpeg] of Object.entries(state.snapshots || {})) {
    snapshots[name] = { jpeg, sha256: hex(await sha256(new TextEncoder().encode(jpeg))) };
  }

  const manifest = {
    truthbox: "1.0",
    order: state.order,
    device: { ua: navigator.userAgent, platform: navigator.platform, lang: navigator.language },
    capture: {
      startedAt: state.startedAt,
      completedAt: new Date().toISOString(),
      frameCount: links.length,
      hashRateFps: 5,
      simulated: state.simulated,
    },
    steps: state.stepLog,
    vision: { engine: "coco-ssd lite_mobilenet_v2 (tfjs)", detection: state.detection.best, measured: state.measured },
    ocr: state.ocr ? { engine: "tesseract.js 5 (wasm)", serialCandidates: state.ocr.serialCandidates, matchedSerial: state.ocr.matchedSerial, confidence: state.ocr.confidence } : null,
    video: videoInfo,
    snapshots,
    chain: {
      algo: "SHA-256(frame || wallMs || monoMs || prev)",
      genesis: "0".repeat(64),
      head: links.length ? links[links.length - 1].h : null,
      merkleRoot: root,
      links,
    },
    verdict,
  };
  manifest.signature = {
    alg: "ECDSA-P256-SHA256",
    publicKeyJwk: state.key.publicKeyJwk,
    value: await signManifest(manifest, state.key.privateKey),
  };
  state.manifest = manifest;
  showResult(manifest);
}

function showResult(m) {
  $("live").style.display = "none";
  $("result").style.display = "block";
  const ok = m.verdict.overall === "VERIFIED";
  $("verdictTitle").textContent = m.verdict.overall;
  $("verdictTitle").style.color = ok ? "var(--brand)" : "var(--warn)";
  $("verdictSub").textContent = ok
    ? "All checks passed. Return window active for 7 days. This manifest is dispute-ready evidence."
    : "Capture completed and signed, but one or more checks did not pass. The manifest records exactly what was seen.";

  const rows = [
    ["Seal confirmed on camera", m.verdict.sealConfirmed, "Buyer confirmed intact seal during recorded capture"],
    ["Item matches SKU class", m.verdict.skuMatch, m.verdict.detectedAs ? `Detected ${m.verdict.detectedAs.label} at ${Math.round(m.verdict.detectedAs.score * 100)}%, expected ${m.order.expectedClass}` : "No confident detection"],
    ["Serial matches pattern", m.verdict.serialMatch, m.verdict.serial ? `Read ${m.verdict.serial}` : "No serial matched " + m.order.serialPattern],
    ["Chain of custody", true, `${m.capture.frameCount} frames hashed at 5 fps, unbroken`],
    ["Signature", true, "ECDSA P-256, key generated non-extractable for this capture"],
  ];
  if (m.verdict.dimensionCheck !== "unknown") {
    rows.splice(2, 0, ["Dimensions within tolerance", m.verdict.dimensionCheck === "pass",
      `Measured ~${m.verdict.measuredMm.wMm} x ${m.verdict.measuredMm.hMm} mm vs SKU ${m.order.dims.wMm} x ${m.order.dims.hMm ?? "?"} mm (QR-calibrated)`]);
  }
  $("verdictRows").innerHTML = rows.map(([name, ok2, detail]) => `
    <div class="checkrow ${ok2 ? "ok" : "fail"}">
      <span class="icon">${ok2 ? "&#10003;" : "&#10007;"}</span>
      <div><div class="name">${name}</div><div class="detail">${detail}</div></div>
    </div>`).join("");

  $("chainSummary").textContent =
    `order      ${m.order.id}\n` +
    `nonce      ${m.order.nonce}\n` +
    `frames     ${m.capture.frameCount}\n` +
    `head       ${m.chain.head}\n` +
    `merkle     ${m.chain.merkleRoot}\n` +
    (m.video ? `video      ${m.video.sha256.slice(0, 32)}... (${(m.video.bytes / 1e6).toFixed(2)} MB)\n` : "") +
    `signature  ${m.signature.value.slice(0, 44)}...`;

  $("downloadManifest").onclick = () => downloadBlob(
    new Blob([JSON.stringify(m, null, 2)], { type: "application/json" }),
    `truthbox-${m.order.id}.json`
  );
  $("downloadVideo").disabled = !state.videoBlob;
  $("downloadVideo").onclick = () => state.videoBlob && downloadBlob(state.videoBlob, `truthbox-${m.order.id}.webm`);

  $("shareLink").onclick = async () => {
    const url = await manifestToLink(m, new URL("verify.html", location.href).href);
    try {
      await navigator.clipboard.writeText(url);
      $("shareLink").textContent = "Link copied (" + Math.round(url.length / 1024) + " KB)";
    } catch {
      window.open(url, "_blank");
    }
  };
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
