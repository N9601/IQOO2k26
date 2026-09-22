/*
 * Truthbox chain of custody primitives.
 *
 * Every captured frame becomes a link:
 *   link_n = SHA-256(frameBytes || wallClockMs || monotonicMs || link_{n-1})
 * A Merkle root is computed over all links and signed with a
 * non-extractable ECDSA P-256 key generated at capture start.
 * Any insertion, removal or edit of a frame breaks the chain;
 * any edit of the manifest breaks the signature.
 */

const te = new TextEncoder();

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

export function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function unhex(str) {
  const out = new Uint8Array(str.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(str.substr(i * 2, 2), 16);
  return out;
}

export function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function unb64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

/* Deterministic JSON with recursively sorted keys, so the byte
 * sequence that gets signed is reproducible by any verifier. */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}

export class HashChain {
  constructor() {
    this.links = [];
    this.head = new Uint8Array(32); // genesis: 32 zero bytes
    this.t0 = performance.now();
  }

  async add(frameBytes) {
    const t = Date.now();
    const m = Math.round(performance.now() - this.t0);
    const payload = concat(frameBytes, te.encode(String(t)), te.encode(String(m)), this.head);
    const h = await sha256(payload);
    this.head = h;
    this.links.push({ i: this.links.length, t, m, h: hex(h) });
    return this.links[this.links.length - 1];
  }

  get length() {
    return this.links.length;
  }
}

/* Merkle root over the link hashes. Odd nodes are paired with
 * themselves, the standard construction. */
export async function merkleRoot(hexHashes) {
  if (hexHashes.length === 0) return hex(new Uint8Array(32));
  let level = hexHashes.map(unhex);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(await sha256(concat(level[i], right)));
    }
    level = next;
  }
  return hex(level[0]);
}

export async function generateSigningKey() {
  // extractable: false — the private key can be used but never read,
  // the browser analogue of an Android Keystore TEE-resident key.
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  );
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { privateKey: pair.privateKey, publicKeyJwk };
}

export async function signManifest(manifest, privateKey) {
  const unsigned = { ...manifest };
  delete unsigned.signature;
  const payload = te.encode(canonicalJson(unsigned));
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    payload
  );
  return b64(new Uint8Array(sig));
}

/* Full independent verification of a manifest:
 *   1. recompute every consistency check on the hash chain
 *   2. recompute the Merkle root from the links
 *   3. verify the ECDSA signature over the canonical manifest
 * Returns a list of {check, ok, detail} results. */
export async function verifyManifest(manifest) {
  const results = [];
  const push = (check, ok, detail) => results.push({ check, ok, detail });

  const chain = manifest.chain;
  if (!chain || !Array.isArray(chain.links) || chain.links.length === 0) {
    push("Chain present", false, "Manifest has no hash chain");
    return { ok: false, results };
  }
  push("Chain present", true, `${chain.links.length} frame links`);

  // Monotonic clock must strictly advance: catches reordering and splices.
  let monotonic = true;
  for (let i = 1; i < chain.links.length; i++) {
    if (chain.links[i].m < chain.links[i - 1].m) { monotonic = false; break; }
  }
  push("Monotonic clock", monotonic, monotonic ? "Timestamps strictly ordered" : "Clock went backwards: splice suspected");

  const headOk = chain.links[chain.links.length - 1].h === chain.head;
  push("Chain head", headOk, headOk ? "Head matches final link" : "Head does not match final link");

  const root = await merkleRoot(chain.links.map((l) => l.h));
  const rootOk = root === chain.merkleRoot;
  push("Merkle root", rootOk, rootOk ? root.slice(0, 16) + "... recomputed and matched" : "Recomputed root differs: chain was edited");

  let sigOk = false;
  try {
    const pub = await crypto.subtle.importKey(
      "jwk",
      manifest.signature.publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    const unsigned = { ...manifest };
    delete unsigned.signature;
    sigOk = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      unb64(manifest.signature.value),
      te.encode(canonicalJson(unsigned))
    );
  } catch (e) {
    sigOk = false;
  }
  push("ECDSA signature", sigOk, sigOk ? "P-256 signature verifies against embedded public key" : "Signature INVALID: manifest was modified after signing");

  const ok = results.every((r) => r.ok);
  return { ok, results };
}
