/*
 * Escaping for untrusted text. Manifests arrive from files, verification
 * links and QR codes, so every field rendered as HTML goes through these.
 */

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/* Safe in element content and inside quoted attribute values. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/* A snapshot is only rendered when it is a base64 image data URL;
 * anything else (a remote URL, javascript:, injected markup) becomes "". */
export function imageSrc(value) {
  return typeof value === "string" && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(value)
    ? value
    : "";
}
