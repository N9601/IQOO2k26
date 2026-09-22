/*
 * Cross-brand fraud intelligence. Demo claim dataset clustered live:
 * claims are grouped by salted claimant hash, risk is scored by flagged
 * share weighted by cross-brand spread, and the bipartite claim network
 * is rendered as SVG. The point being demonstrated: repeat offenders are
 * invisible to any single brand and obvious the moment data is pooled.
 */

const $ = (id) => document.getElementById(id);

const BRANDS = ["Aurora Electronics", "Kesari Cosmetics", "Nimbus Audio", "Vetra Apparel"];

/* Seeded demo dataset: claimant -> claims against brands.
 * h() stands in for SHA-256(salt || upi || pincode) done brand-side. */
const CLAIMS = [
  // Honest customers: single brand, verified claims.
  { id: "a91f", brand: 0, flagged: false }, { id: "b220", brand: 1, flagged: false },
  { id: "c7d3", brand: 2, flagged: false }, { id: "d5e8", brand: 3, flagged: false },
  { id: "e102", brand: 0, flagged: false }, { id: "f9ab", brand: 1, flagged: false },
  { id: "0a44", brand: 2, flagged: false }, { id: "1b55", brand: 0, flagged: false },
  // One-off flagged claims: could be honest mistakes.
  { id: "2c66", brand: 1, flagged: true }, { id: "3d77", brand: 3, flagged: false },
  { id: "3d77", brand: 3, flagged: true },
  // Ring member 1: hits every brand once, mostly flagged.
  { id: "77aa", brand: 0, flagged: true }, { id: "77aa", brand: 1, flagged: true },
  { id: "77aa", brand: 2, flagged: false }, { id: "77aa", brand: 3, flagged: true },
  // Ring member 2: heavy on two brands.
  { id: "88bb", brand: 0, flagged: true }, { id: "88bb", brand: 0, flagged: true },
  { id: "88bb", brand: 2, flagged: true }, { id: "88bb", brand: 2, flagged: false },
  { id: "88bb", brand: 2, flagged: true },
  // Ring member 3: spread thin, one claim per brand, each looks clean-ish alone.
  { id: "99cc", brand: 0, flagged: true }, { id: "99cc", brand: 1, flagged: false },
  { id: "99cc", brand: 2, flagged: true }, { id: "99cc", brand: 3, flagged: true },
  // Ring member 4.
  { id: "aadd", brand: 1, flagged: true }, { id: "aadd", brand: 3, flagged: true },
  { id: "aadd", brand: 1, flagged: true },
];

/* ---------- clustering ---------- */

function cluster() {
  const by = new Map();
  for (const c of CLAIMS) {
    if (!by.has(c.id)) by.set(c.id, { id: c.id, claims: 0, flagged: 0, brands: new Set() });
    const e = by.get(c.id);
    e.claims++;
    if (c.flagged) e.flagged++;
    e.brands.add(c.brand);
  }
  const rows = [...by.values()].map((e) => {
    const flaggedShare = e.flagged / e.claims;
    const spread = e.brands.size;
    // Cross-brand spread is the multiplier a single brand can never apply.
    const risk = Math.min(1, flaggedShare * (0.6 + 0.2 * spread));
    return { ...e, spread, risk };
  });
  rows.sort((a, b) => b.risk - a.risk);
  return rows;
}

const rows = cluster();
// "Repeat" means repeat: one flagged claim alone never blacklists anyone.
const offenders = rows.filter((r) => r.risk >= 0.5 && r.claims >= 2);

/* ---------- stats ---------- */

const gmestAtRisk = offenders.reduce((n, o) => n + o.claims, 0) * 1849; // avg order value, demo
$("intelStats").innerHTML = `
  <div class="card stat"><div class="num red">${offenders.length}</div><div class="label">repeat offenders detected</div></div>
  <div class="card stat"><div class="num">${offenders.reduce((n, o) => n + o.claims, 0)}</div><div class="label">claims linked to offender clusters</div></div>
  <div class="card stat"><div class="num">${BRANDS.length}</div><div class="label">brands pooling signals (opt-in)</div></div>
  <div class="card stat"><div class="num red">Rs ${(gmestAtRisk / 1000).toFixed(0)}k</div><div class="label">order value at risk in linked claims</div></div>`;

/* ---------- bipartite network (SVG) ---------- */

function renderNetwork() {
  const W = 900, H = 420, padY = 40;
  const bx = 190, cx = 690; // brand and claimant column x
  const claimants = rows;
  const by = (i, n) => padY + ((H - 2 * padY) / Math.max(1, n - 1)) * i;

  let edges = "";
  for (const c of CLAIMS) {
    const bi = c.brand, ci = claimants.findIndex((r) => r.id === c.id);
    const y1 = by(bi, BRANDS.length), y2 = by(ci, claimants.length);
    const col = c.flagged ? "#e06c6c" : "#3fbf7f";
    edges += `<path d="M${bx + 12},${y1} C ${(bx + cx) / 2},${y1} ${(bx + cx) / 2},${y2} ${cx - 12},${y2}" fill="none" stroke="${col}" stroke-width="1.6" opacity="0.55"/>`;
  }

  let nodes = "";
  BRANDS.forEach((b, i) => {
    const y = by(i, BRANDS.length);
    nodes += `<circle cx="${bx}" cy="${y}" r="9" fill="#22221e" stroke="#3a3a33" stroke-width="1.5"/>`;
    nodes += `<text x="${bx - 18}" y="${y + 4}" text-anchor="end" font-size="12.5" fill="#a5a297">${b}</text>`;
  });
  claimants.forEach((c, i) => {
    const y = by(i, claimants.length);
    const bad = c.risk >= 0.5 && c.claims >= 2;
    const r = 5 + c.claims * 1.4;
    nodes += `<circle cx="${cx}" cy="${y}" r="${r}" fill="${bad ? "rgba(224,108,108,0.15)" : "rgba(63,191,127,0.12)"}" stroke="${bad ? "#e06c6c" : "#2a8f5c"}" stroke-width="1.5"><title>${c.id}: ${c.claims} claims, ${c.flagged} flagged, risk ${(c.risk * 100).toFixed(0)}%</title></circle>`;
    nodes += `<text x="${cx + r + 8}" y="${y + 4}" font-size="11.5" font-family="monospace" fill="${bad ? "#e06c6c" : "#6e6b61"}">${c.id}${bad ? " !" : ""}</text>`;
  });

  $("network").innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bipartite network of brands and claimants; red edges are flagged claims converging on a few repeat claimant nodes">
      <text x="${bx}" y="20" text-anchor="middle" font-size="11" letter-spacing="2" fill="#6e6b61">BRANDS</text>
      <text x="${cx}" y="20" text-anchor="middle" font-size="11" letter-spacing="2" fill="#6e6b61">CLAIMANT HASHES</text>
      ${edges}${nodes}
    </svg>`;
}
renderNetwork();

/* ---------- offender table ---------- */

function riskBadge(r, claims) {
  if (claims >= 2 && r >= 0.7) return `<span class="badge fail"><span class="dot"></span>${(r * 100).toFixed(0)}% high</span>`;
  if (claims >= 2 && r >= 0.5) return `<span class="badge warn"><span class="dot"></span>${(r * 100).toFixed(0)}% elevated</span>`;
  return `<span class="badge ok"><span class="dot"></span>${(r * 100).toFixed(0)}% normal</span>`;
}

document.querySelector("#offenderTable tbody").innerHTML = rows
  .map((r) => `<tr>
    <td class="idhash">sha256:${r.id}...</td>
    <td>${[...r.brands].map((b) => BRANDS[b].split(" ")[0]).join(", ")}</td>
    <td>${r.claims}</td>
    <td>${r.flagged}</td>
    <td>${riskBadge(r.risk, r.claims)}</td>
  </tr>`).join("");
