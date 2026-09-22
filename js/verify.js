/*
 * Truthbox verifier. Loads a manifest, runs the full independent
 * verification (chain consistency, Merkle root, ECDSA signature),
 * then lets the user attack the evidence and watch it fail.
 */

import { verifyManifest, HashChain, merkleRoot, generateSigningKey, signManifest, hex } from "./crypto.js";
import { openReport } from "./report.js";
import { linkFragmentToManifest } from "./share.js";

// A verification link carries the whole manifest in its fragment.
const loadFromHash = () => linkFragmentToManifest(location.hash).then((m) => { if (m) loadManifest(m); });
loadFromHash();
window.addEventListener("hashchange", loadFromHash);

const $ = (id) => document.getElementById(id);

let original = null; // pristine manifest as loaded
let current = null;  // possibly tampered copy

/* ---------- load ---------- */

const drop = $("drop");
drop.addEventListener("click", () => $("fileInput").click());
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const f = e.dataTransfer.files[0];
  if (f) readFile(f);
});
$("fileInput").addEventListener("change", (e) => {
  if (e.target.files[0]) readFile(e.target.files[0]);
});

function readFile(f) {
  const r = new FileReader();
  r.onload = () => {
    try {
      loadManifest(JSON.parse(r.result));
    } catch {
      alert("Not valid JSON.");
    }
  };
  r.readAsText(f);
}

/* A real signed manifest built live: 40 synthetic frames hashed into a
 * chain, Merkle root computed, ECDSA key generated and used to sign.
 * Nothing pre-baked; reload and the hashes and key change. */
$("demoBtn").addEventListener("click", async () => {
  $("demoBtn").disabled = true;
  $("demoBtn").textContent = "Building and signing...";
  const chain = new HashChain();
  const frame = new Uint8Array(4096);
  for (let i = 0; i < 40; i++) {
    crypto.getRandomValues(frame);
    await chain.add(frame);
  }
  const key = await generateSigningKey();
  const manifest = {
    truthbox: "1.0",
    order: { id: "TB-2026-DEMO01", nonce: hex(crypto.getRandomValues(new Uint8Array(16))), expectedClass: "cell phone", serialPattern: "[A-Z0-9]{6,}" },
    device: { ua: navigator.userAgent, platform: navigator.platform, lang: navigator.language },
    capture: { startedAt: new Date(Date.now() - 32000).toISOString(), completedAt: new Date().toISOString(), frameCount: chain.length, hashRateFps: 5, simulated: true },
    steps: [
      { id: "seal", at: new Date(Date.now() - 30000).toISOString(), evidence: { confirmedBy: "buyer", frame: 4 } },
      { id: "open", at: new Date(Date.now() - 22000).toISOString(), evidence: { confirmedBy: "buyer", frame: 14 } },
      { id: "reveal", at: new Date(Date.now() - 12000).toISOString(), evidence: { confirmedBy: "detector", detection: { label: "cell phone", score: 0.82 }, frame: 26 } },
      { id: "label", at: new Date(Date.now() - 4000).toISOString(), evidence: { ocr: { serialCandidates: ["SN84210967"], matchedSerial: "SN84210967", confidence: 91 }, frame: 36 } },
    ],
    vision: { engine: "coco-ssd lite_mobilenet_v2 (tfjs)", detection: { label: "cell phone", score: 0.82 } },
    ocr: { engine: "tesseract.js 5 (wasm)", serialCandidates: ["SN84210967"], matchedSerial: "SN84210967", confidence: 91 },
    video: null,
    chain: {
      algo: "SHA-256(frame || wallMs || monoMs || prev)",
      genesis: "0".repeat(64),
      head: chain.links[chain.links.length - 1].h,
      merkleRoot: await merkleRoot(chain.links.map((l) => l.h)),
      links: chain.links,
    },
    verdict: { sealConfirmed: true, skuMatch: true, detectedAs: { label: "cell phone", score: 0.82 }, serialMatch: true, serial: "SN84210967", simulatedFeed: true, overall: "VERIFIED" },
  };
  manifest.signature = {
    alg: "ECDSA-P256-SHA256",
    publicKeyJwk: key.publicKeyJwk,
    value: await signManifest(manifest, key.privateKey),
  };
  $("demoBtn").disabled = false;
  $("demoBtn").textContent = "Generate a signed demo manifest";
  loadManifest(manifest);
});

/* ---------- verify and render ---------- */

async function loadManifest(m) {
  original = JSON.parse(JSON.stringify(m));
  current = m;
  $("results").style.display = "block";
  $("tamperlab").style.display = "block";
  $("attackNote").textContent = "";
  await render();
}

let lastResults = [];

async function render() {
  const { ok, results } = await verifyManifest(current);
  lastResults = results;
  const bv = $("bigverdict");
  bv.className = "bigverdict " + (ok ? "ok" : "fail");
  $("verdictGlyph").innerHTML = ok ? "&#10003;" : "&#10007;";
  $("verdictText").textContent = ok ? "EVIDENCE VERIFIED" : "EVIDENCE REJECTED";
  $("verdictDetail").textContent = ok
    ? "The chain of custody is unbroken and the signature is valid. This capture happened exactly as recorded."
    : "This manifest does not prove what it claims. At least one integrity check failed.";

  $("checkList").innerHTML = results.map((r) => `
    <div class="checkrow ${r.ok ? "ok" : "fail"}">
      <span class="icon">${r.ok ? "&#10003;" : "&#10007;"}</span>
      <div><div class="name">${r.check}</div><div class="detail">${r.detail}</div></div>
    </div>`).join("");

  renderViz(results);

  const m = current;
  const snaps = m.snapshots && Object.keys(m.snapshots).length
    ? `<div style="display:flex; gap:10px; flex-wrap:wrap; margin:12px 0">` +
      Object.entries(m.snapshots).map(([k, s]) =>
        `<figure style="margin:0"><img src="${String(s.jpeg).startsWith("data:image/") ? s.jpeg : ""}" alt="${k}" style="width:150px; border-radius:8px; border:1px solid var(--line)"><figcaption class="sub" style="margin-top:4px">${k} - signed still</figcaption></figure>`
      ).join("") + `</div>`
    : "";
  $("manifestMeta").innerHTML = `
    <h3>Manifest</h3>${snaps}
    <pre class="block">order      ${m.order?.id ?? "?"}
nonce      ${m.order?.nonce ?? "?"}
captured   ${m.capture?.startedAt ?? "?"}
frames     ${m.chain?.links?.length ?? 0}
verdict    ${m.verdict?.overall ?? "?"}${m.capture?.simulated ? "  (simulated feed)" : ""}
serial     ${m.verdict?.serial ?? "none"}
merkle     ${m.chain?.merkleRoot ?? "?"}
key        ${m.signature?.publicKeyJwk?.x?.slice(0, 24) ?? "?"}...
signature  ${m.signature?.value?.slice(0, 44) ?? "?"}...</pre>`;
}

$("reportBtn").addEventListener("click", () => {
  if (!current) return;
  if (!openReport(current, lastResults)) alert("Popup blocked. Allow popups to export the report.");
});

/* ---------- chain visualization ---------- */

function renderViz(results) {
  const by = Object.fromEntries(results.map((r) => [r.check, r.ok]));
  const links = current.chain?.links || [];
  const strip = $("vizStrip");
  const N = Math.min(links.length, 96);
  const step = links.length / N || 1;

  // Localize what we can: the first monotonic-clock violation.
  let badIdx = -1;
  for (let i = 1; i < links.length; i++) {
    if (links[i].m < links[i - 1].m) { badIdx = i; break; }
  }
  const merkleOk = by["Merkle root"] !== false;
  const headOk = by["Chain head"] !== false;

  let html = "";
  for (let k = 0; k < N; k++) {
    const i = Math.floor(k * step);
    let cls = "fr";
    if (badIdx >= 0 && i >= badIdx) cls += " bad";
    else if (!merkleOk) cls += " warn";
    else if (!headOk && k === N - 1) cls += " bad";
    html += `<div class="${cls}" title="frame ${links[i].i}  ${links[i].h.slice(0, 12)}..."></div>`;
  }
  strip.innerHTML = html;

  const sigOk = by["ECDSA signature"] !== false;
  $("vizTail").innerHTML =
    `<span class="lnk">${links.length} links -&gt;</span>` +
    `<span class="node${merkleOk && headOk ? "" : " bad"}">MERKLE ROOT ${merkleOk && headOk ? "intact" : "BROKEN"}</span>` +
    `<span class="lnk">-&gt;</span>` +
    `<span class="node${sigOk ? "" : " bad"}">SIGNATURE ${sigOk ? "valid" : "INVALID"}</span>`;
}

/* ---------- tamper lab ---------- */

const ATTACKS = {
  serial(m) {
    if (m.ocr) m.ocr.matchedSerial = "SN00000001";
    if (m.verdict) m.verdict.serial = "SN00000001";
    return "Serial rewritten to SN00000001, the classic swap-fraud edit. The signed bytes no longer match.";
  },
  verdict(m) {
    if (m.verdict) { m.verdict.overall = "VERIFIED"; m.verdict.skuMatch = true; m.verdict.serialMatch = true; }
    return "Verdict flipped to VERIFIED. A fraudster cannot upgrade their own evidence: the signature covers the verdict.";
  },
  frame(m) {
    const links = m.chain?.links;
    if (links?.length) {
      const i = Math.floor(links.length / 2);
      links[i].h = links[i].h.slice(0, -4) + (links[i].h.endsWith("0000") ? "1111" : "0000");
    }
    return "One frame hash edited mid-chain. The recomputed Merkle root no longer matches the signed root.";
  },
  drop(m) {
    if (m.chain?.links?.length > 12) m.chain.links.splice(10, 10);
    return "Ten frames silently removed, hiding ten seconds of the capture. Merkle root and head both break.";
  },
  time(m) {
    if (m.capture) m.capture.startedAt = "2026-01-01T09:00:00.000Z";
    return "Capture backdated by months to fit inside a return window. The timestamp is inside the signed payload.";
  },
  restore() {
    return "Original manifest restored. All checks pass again.";
  },
};

document.querySelectorAll("[data-attack]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (!original) return;
    const kind = btn.dataset.attack;
    if (kind === "restore") {
      current = JSON.parse(JSON.stringify(original));
      $("attackNote").textContent = ATTACKS.restore();
    } else {
      const note = ATTACKS[kind](current);
      $("attackNote").textContent = note;
    }
    await render();
  });
});
