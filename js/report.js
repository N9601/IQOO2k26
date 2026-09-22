/*
 * Dispute evidence report: a print-ready, self-contained document a
 * seller attaches to a marketplace dispute or chargeback response.
 * Built entirely client-side from the verified manifest.
 */

export function openReport(m, results) {
  const ok = results.every((r) => r.ok);
  const when = new Date().toISOString();
  const esc = (s) => String(s ?? "-").replace(/&/g, "&amp;").replace(/</g, "&lt;");

  const checksRows = results.map((r) => `
    <tr>
      <td class="${r.ok ? "ok" : "fail"}">${r.ok ? "PASS" : "FAIL"}</td>
      <td><strong>${esc(r.check)}</strong></td>
      <td>${esc(r.detail)}</td>
    </tr>`).join("");

  const dims = m.verdict?.measuredMm
    ? `~${m.verdict.measuredMm.wMm} x ${m.verdict.measuredMm.hMm} mm (planar QR calibration)`
    : "not measured";

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Truthbox evidence report ${esc(m.order?.id)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #16150f; margin: 40px auto; max-width: 720px; line-height: 1.55; }
  header { border-bottom: 3px double #16150f; padding-bottom: 14px; margin-bottom: 24px; }
  h1 { font-size: 24px; margin: 0; font-weight: 600; letter-spacing: 0.02em; }
  .sub { color: #5a564a; font-size: 13px; margin-top: 4px; }
  .verdict { font-size: 19px; font-weight: 700; padding: 12px 16px; margin: 20px 0; border: 2px solid ${ok ? "#1e7f4f" : "#c62f34"}; color: ${ok ? "#1e7f4f" : "#c62f34"}; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.12em; margin: 26px 0 8px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td, th { border: 1px solid #c9c4b4; padding: 7px 9px; text-align: left; vertical-align: top; }
  td.ok { color: #1e7f4f; font-weight: 700; width: 52px; }
  td.fail { color: #c62f34; font-weight: 700; width: 52px; }
  .mono { font-family: "Courier New", monospace; font-size: 11.5px; word-break: break-all; }
  .kv td:first-child { width: 200px; color: #5a564a; }
  footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #c9c4b4; font-size: 11.5px; color: #5a564a; }
  @media print { body { margin: 10mm; } .noprint { display: none; } }
  .noprint { margin: 20px 0; }
  .noprint button { padding: 8px 18px; font-size: 14px; cursor: pointer; }
</style></head><body>
<header>
  <h1>TRUTHBOX &mdash; Unboxing Evidence Report</h1>
  <div class="sub">Cryptographically verifiable chain-of-custody record &middot; Protocol v${esc(m.truthbox)}</div>
</header>

<div class="verdict">${ok ? "EVIDENCE VERIFIED: all integrity checks passed" : "EVIDENCE REJECTED: integrity check failure"} &mdash; capture verdict ${esc(m.verdict?.overall)}</div>

<h2>Order</h2>
<table class="kv">
  <tr><td>Order ID</td><td>${esc(m.order?.id)}</td></tr>
  <tr><td>Dispatch nonce</td><td class="mono">${esc(m.order?.nonce)}</td></tr>
  <tr><td>Expected item class</td><td>${esc(m.order?.expectedClass)}</td></tr>
  <tr><td>Capture started</td><td>${esc(m.capture?.startedAt)}</td></tr>
  <tr><td>Capture completed</td><td>${esc(m.capture?.completedAt)}</td></tr>
  <tr><td>Capture mode</td><td>${m.capture?.simulated ? "SIMULATED FEED (demo)" : "live camera"}</td></tr>
</table>

<h2>Integrity verification</h2>
<table>${checksRows}</table>

<h2>Observed evidence</h2>
<table class="kv">
  <tr><td>Item detected as</td><td>${esc(m.verdict?.detectedAs?.label)} ${m.verdict?.detectedAs ? "(" + Math.round(m.verdict.detectedAs.score * 100) + "% confidence)" : ""}</td></tr>
  <tr><td>Serial read</td><td class="mono">${esc(m.verdict?.serial ?? "none")}</td></tr>
  <tr><td>Measured dimensions</td><td>${dims}</td></tr>
  <tr><td>Seal confirmed</td><td>${m.verdict?.sealConfirmed ? "yes, on camera" : "no"}</td></tr>
  <tr><td>Frames in chain</td><td>${m.chain?.links?.length ?? 0} at ${esc(m.capture?.hashRateFps)} fps</td></tr>
  <tr><td>Proof video SHA-256</td><td class="mono">${esc(m.video?.sha256 ?? "no video")}</td></tr>
</table>

<h2>Cryptographic anchors</h2>
<table class="kv">
  <tr><td>Chain head</td><td class="mono">${esc(m.chain?.head)}</td></tr>
  <tr><td>Merkle root</td><td class="mono">${esc(m.chain?.merkleRoot)}</td></tr>
  <tr><td>Signature (${esc(m.signature?.alg)})</td><td class="mono">${esc(m.signature?.value)}</td></tr>
  <tr><td>Public key (JWK x)</td><td class="mono">${esc(m.signature?.publicKeyJwk?.x)}</td></tr>
</table>

<div class="noprint"><button onclick="window.print()">Print / save as PDF</button></div>

<footer>
  Report generated ${when} by the Truthbox independent verifier, which runs entirely in the browser of the party checking the evidence.
  To reproduce: load the manifest JSON at the Truthbox verify page and compare the anchors above. Any alteration of the manifest,
  including a single character, causes the ECDSA P-256 signature check to fail. Verifier and protocol: github.com/N9601/IQOO2k26.
</footer>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
