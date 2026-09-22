/*
 * Truthbox seller portal: fleet chart, dispatch QR generation and
 * manifest inbox with client-side verification on ingest.
 */

import { verifyManifest, hex } from "./crypto.js";

const $ = (id) => document.getElementById(id);

/* ---------- weekly chart (single series, SVG) ---------- */

const WEEKS = [
  { w: "W31", v: 214 }, { w: "W32", v: 267 }, { w: "W33", v: 301 },
  { w: "W34", v: 296 }, { w: "W35", v: 352 }, { w: "W36", v: 419 },
  { w: "W37", v: 468 }, { w: "W38", v: 530 },
];
const SERIES = "#1aa863"; // validated against dark surface #161e29

function renderChart() {
  const W = 900, H = 300, padL = 46, padR = 16, padT = 18, padB = 34;
  const max = 600; // rounded axis max above data max
  const iw = W - padL - padR, ih = H - padT - padB;
  const bw = Math.min(56, (iw / WEEKS.length) * 0.55);

  const y = (v) => padT + ih - (v / max) * ih;
  const x = (i) => padL + (iw / WEEKS.length) * (i + 0.5);

  let g = "";
  for (const t of [0, 150, 300, 450, 600]) {
    g += `<line x1="${padL}" y1="${y(t)}" x2="${W - padR}" y2="${y(t)}" stroke="#24303f" stroke-width="1"/>`;
    g += `<text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="#8b98a9">${t}</text>`;
  }
  let bars = "";
  WEEKS.forEach((d, i) => {
    const bx = x(i) - bw / 2, by = y(d.v), bh = padT + ih - by;
    bars += `<path data-i="${i}" d="M${bx},${by + 4} a4,4 0 0 1 4,-4 h${bw - 8} a4,4 0 0 1 4,4 v${bh - 4} h${-bw} z" fill="${SERIES}"/>`;
    bars += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#8b98a9">${d.w}</text>`;
    if (i === WEEKS.length - 1) {
      bars += `<text x="${x(i)}" y="${by - 8}" text-anchor="middle" font-size="12" font-weight="700" fill="#e8eef5">${d.v}</text>`;
    }
  });
  $("chart").innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verified unboxings per week, rising from 214 in week 31 to 530 in week 38">${g}${bars}</svg>`;

  const tip = $("chartTip");
  $("chart").querySelectorAll("path[data-i]").forEach((p) => {
    p.addEventListener("mousemove", (e) => {
      const d = WEEKS[+p.dataset.i];
      tip.style.display = "block";
      tip.style.left = e.clientX + 14 + "px";
      tip.style.top = e.clientY - 10 + "px";
      tip.querySelector(".v").textContent = d.v;
      tip.querySelector(".k").textContent = "verified unboxings, " + d.w;
    });
    p.addEventListener("mouseleave", () => (tip.style.display = "none"));
  });

  $("chartTable").innerHTML =
    "<thead><tr><th>Week</th><th>Verified unboxings</th></tr></thead><tbody>" +
    WEEKS.map((d) => `<tr><td>${d.w}</td><td>${d.v}</td></tr>`).join("") +
    "</tbody>";
}
renderChart();

/* ---------- dispatch QR ---------- */

$("qOrder").value = "TB-2026-" + String(Math.floor(100000 + Math.random() * 900000));

$("qrBtn").addEventListener("click", () => {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const url = new URL("capture.html", location.href);
  url.searchParams.set("order", $("qOrder").value.trim());
  url.searchParams.set("cls", $("qClass").value);
  url.searchParams.set("serial", $("qSerial").value.trim());
  url.searchParams.set("nonce", nonce);
  $("qrbox").innerHTML = "";
  new QRCode($("qrbox"), { text: url.href, width: 164, height: 164, correctLevel: QRCode.CorrectLevel.M });
  $("qrlink").textContent = url.href;
  $("qrlink").href = url.href;
  $("qrResult").style.display = "flex";
});

/* ---------- manifest inbox ---------- */

const SEED = [
  { order: "TB-2026-114522", item: "cell phone", serial: "SN84210967", evidence: "manifest + 2.1 MB video", status: "verified" },
  { order: "TB-2026-114301", item: "bottle", serial: "BT5529104", evidence: "manifest + 1.8 MB video", status: "verified" },
  { order: "TB-2026-113987", item: "cell phone", serial: "none read", evidence: "manifest (serial check failed)", status: "flagged" },
  { order: "TB-2026-113712", item: "-", serial: "-", evidence: "no capture before return claim", status: "review" },
];

function loadRows() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem("tb-inbox") || "[]"); } catch {}
  return [...saved, ...SEED];
}

function badge(status) {
  const map = {
    verified: ["ok", "Verified"],
    flagged: ["warn", "Flagged"],
    rejected: ["fail", "Evidence rejected"],
    review: ["info", "Manual review"],
  };
  const [cls, label] = map[status] || ["info", status];
  return `<span class="badge ${cls}"><span class="dot"></span>${label}</span>`;
}

function renderRows() {
  document.querySelector("#ordersTable tbody").innerHTML = loadRows()
    .map((r) => `<tr><td>${r.order}</td><td>${r.item}</td><td class="hash">${r.serial}</td><td class="muted">${r.evidence}</td><td>${badge(r.status)}</td></tr>`)
    .join("");
}
renderRows();

const dz = $("inboxDrop");
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", async (e) => {
  e.preventDefault();
  dz.classList.remove("over");
  const f = e.dataTransfer.files[0];
  if (!f) return;
  let m;
  try { m = JSON.parse(await f.text()); } catch { dz.textContent = "Not valid JSON."; return; }
  const { ok } = await verifyManifest(m);
  const status = !ok ? "rejected" : m.verdict?.overall === "VERIFIED" ? "verified" : "flagged";
  const row = {
    order: m.order?.id || "unknown",
    item: m.vision?.detection?.label || m.order?.expectedClass || "-",
    serial: m.verdict?.serial || "none read",
    evidence: `manifest, ${m.chain?.links?.length || 0} frames` + (m.video ? " + video" : ""),
    status,
  };
  try {
    const saved = JSON.parse(localStorage.getItem("tb-inbox") || "[]");
    saved.unshift(row);
    localStorage.setItem("tb-inbox", JSON.stringify(saved.slice(0, 20)));
  } catch {}
  renderRows();
  dz.textContent = ok
    ? "Manifest verified and ingested: " + row.order
    : "Manifest REJECTED (integrity failure) and logged: " + row.order;
});
