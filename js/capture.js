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
import { loadDetector, detect } from "./detect.js";
import { loadOcr, readLabel } from "./ocr.js";

const $ = (id) => document.getElementById(id);

const STEPS = [
  { id: "seal",   name: "Seal check",   banner: "Position the sealed parcel",  hint: "Show all sides of the tamper seal to the camera.", action: "Seal is intact" },
  { id: "open",   name: "Opening",      banner: "Open the parcel on camera",   hint: "Keep the parcel in frame while you open it. Do not cut away.", action: "Parcel is open" },
  { id: "reveal", name: "Item reveal",  banner: "Show the item to the camera", hint: "Hold the item steady in frame. Detection runs on-device.", action: "Waiting for detection..." },
  { id: "label",  name: "Label OCR",    banner: "Position the serial label",   hint: "Fit the serial or MRP label inside the dashed target.", action: "Read label" },
  { id: "sign",   name: "Sign",         banner: "Sealing the evidence",        hint: "Computing Merkle root and signing with the device key.", action: "Signing..." },
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

let modelsReady = false;
Promise.all([loadDetector(), loadOcr()])
  .then(() => {
    modelsReady = true;
    $("modelStatus").textContent = "On-device models loaded. Nothing you record will leave this phone.";
  })
  .catch((e) => {
    $("modelStatus").textContent = "Model load failed (" + e.message + "). Capture still runs; detection and OCR will be marked unavailable.";
    modelsReady = "failed";
  });

$("startBtn").addEventListener("click", startCapture);
$("actionBtn").addEventListener("click", onAction);
$("abortBtn").addEventListener("click", () => location.reload());
$("restartBtn").addEventListener("click", () => location.reload());

/* ---------- capture lifecycle ---------- */

async function startCapture() {
  $("startBtn").disabled = true;
  state.order = {
    id: $("orderId").value.trim() || "TB-UNBOUND",
    nonce: params.get("nonce") || hex(crypto.getRandomValues(new Uint8Array(16))),
    expectedClass: $("skuClass").value,
    serialPattern: $("serialPattern").value.trim() || "[A-Z0-9]{6,}",
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
    (s, i) => `<div class="s" id="rail-${i}">${s.name}</div>`
  ).join("");
}

function enterStep(i) {
  state.step = i;
  const s = STEPS[i];
  $("stepName").textContent = s.banner;
  $("stepHint").textContent = s.hint;
  $("actionBtn").textContent = s.action;
  $("ocrTarget").style.display = s.id === "label" ? "block" : "none";
  for (let k = 0; k < STEPS.length; k++) {
    const el = $("rail-" + k);
    el.className = "s" + (k < i ? " done" : k === i ? " active" : "");
  }
  // Minimum dwell time per step: no step can be skipped instantly.
  $("actionBtn").disabled = true;
  const dwell = s.id === "reveal" ? 0 : 2500;
  if (s.id === "reveal") {
    // Advances automatically on detection; manual confirm unlocks late.
    setTimeout(() => {
      if (state.step === 2 && !state.detection.done) {
        $("actionBtn").textContent = "Confirm item manually";
        $("actionBtn").disabled = false;
      }
    }, 15000);
  } else if (s.id !== "sign") {
    setTimeout(() => { if (state.step === i) $("actionBtn").disabled = false; }, dwell);
  }
  if (s.id === "sign") finalize();
}

async function onAction() {
  const s = STEPS[state.step];
  if (s.id === "seal") {
    logStep("seal", { confirmedBy: "buyer", frame: state.chain.length });
    enterStep(1);
  } else if (s.id === "open") {
    logStep("open", { confirmedBy: "buyer", frame: state.chain.length });
    enterStep(2);
  } else if (s.id === "reveal") {
    // Manual fallback after detection timeout: recorded as such, not hidden.
    logStep("reveal", { confirmedBy: "buyer-manual", detection: state.detection.best, frame: state.chain.length });
    state.detection.done = true;
    enterStep(3);
  } else if (s.id === "label") {
    await doOcr();
  }
}

function logStep(id, evidence) {
  state.stepLog.push({ id, at: new Date().toISOString(), evidence });
}

/* ---------- detection ---------- */

async function runDetection() {
  if (state.step < 1 || state.step > 3) return;
  const video = $("cam");
  if (video.readyState < 2 || modelsReady !== true) return;
  let preds = [];
  try { preds = await detect(video); } catch { return; }
  drawOverlay(preds);
  if (state.step !== 2 || state.detection.done) return;

  const top = preds[0];
  if (!top) { state.detection.hits = 0; return; }
  if (!state.detection.best || top.score > state.detection.best.score) {
    state.detection.best = { label: top.label, score: +top.score.toFixed(3) };
  }
  const match = top.label === state.order.expectedClass;
  $("liveStatus").textContent = `Detected: ${top.label} (${Math.round(top.score * 100)}%)` + (match ? " - matches expected SKU class" : ` - expected ${state.order.expectedClass}`);
  state.detection.hits = match ? state.detection.hits + 1 : 0;
  if (state.detection.hits >= 2) {
    state.detection.done = true;
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
  }
}

/* ---------- OCR ---------- */

async function doOcr() {
  const video = $("cam");
  $("actionBtn").disabled = true;
  $("actionBtn").textContent = "Reading on-device...";
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
    $("liveStatus").textContent = "No text found. Move closer to the label and try again.";
    $("actionBtn").textContent = "Read label";
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
    state.videoBlob = new Blob(state.recordedChunks, { type: state.recordedChunks[0]?.type || "video/webm" });
  }

  const links = state.chain.links;
  const root = await merkleRoot(links.map((l) => l.h));
  let videoInfo = null;
  if (state.videoBlob) {
    const vh = await sha256(new Uint8Array(await state.videoBlob.arrayBuffer()));
    videoInfo = { sha256: hex(vh), bytes: state.videoBlob.size, type: state.videoBlob.type };
  }

  const re = new RegExp(state.order.serialPattern);
  const verdict = {
    sealConfirmed: state.stepLog.some((s) => s.id === "seal"),
    skuMatch: state.detection.best ? state.detection.best.label === state.order.expectedClass : false,
    detectedAs: state.detection.best,
    serialMatch: !!(state.ocr && state.ocr.matchedSerial && re.test(state.ocr.matchedSerial)),
    serial: state.ocr ? state.ocr.matchedSerial : null,
    simulatedFeed: state.simulated,
  };
  verdict.overall = verdict.sealConfirmed && verdict.skuMatch && verdict.serialMatch ? "VERIFIED" : "FLAGGED";

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
    vision: { engine: "coco-ssd lite_mobilenet_v2 (tfjs)", detection: state.detection.best },
    ocr: state.ocr ? { engine: "tesseract.js 5 (wasm)", serialCandidates: state.ocr.serialCandidates, matchedSerial: state.ocr.matchedSerial, confidence: state.ocr.confidence } : null,
    video: videoInfo,
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
    ? "All checks passed. This manifest is dispute-ready evidence."
    : "Capture completed and signed, but one or more checks did not pass. The manifest records exactly what was seen.";

  const rows = [
    ["Seal confirmed on camera", m.verdict.sealConfirmed, "Buyer confirmed intact seal during recorded capture"],
    ["Item matches SKU class", m.verdict.skuMatch, m.verdict.detectedAs ? `Detected ${m.verdict.detectedAs.label} at ${Math.round(m.verdict.detectedAs.score * 100)}%, expected ${m.order.expectedClass}` : "No confident detection"],
    ["Serial matches pattern", m.verdict.serialMatch, m.verdict.serial ? `Read ${m.verdict.serial}` : "No serial matched " + m.order.serialPattern],
    ["Chain of custody", true, `${m.capture.frameCount} frames hashed at 5 fps, unbroken`],
    ["Signature", true, "ECDSA P-256, key generated non-extractable for this capture"],
  ];
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
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
