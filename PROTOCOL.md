# Truthbox evidence protocol v1.0

This document specifies the manifest format and the verification algorithm. Any party can implement a verifier from this page alone; the reference implementation is `js/crypto.js` (about 220 lines, no dependencies).

## 1. Frame hash chain

During capture, frames are sampled at 5 fps. Each sampled frame produces a link:

```
link[0].prev = 0x00 * 32                      (genesis)
link[n].h    = SHA-256(frameBytes || wallClockMs || monotonicMs || link[n-1].h)
```

- `frameBytes`: raw RGBA bytes of the frame downscaled to 320x240.
- `wallClockMs`: `Date.now()` as decimal ASCII.
- `monotonicMs`: milliseconds since capture start from the monotonic clock (`performance.now()`), as decimal ASCII. Immune to wall-clock tampering.
- `||` is byte concatenation.

Each link is recorded in the manifest as `{i, t, m, h}`: index, wall time, monotonic time, hex hash.

Properties:
- Inserting, removing or reordering a frame changes every subsequent hash.
- The monotonic timestamps must be non-decreasing; a violation indicates a splice.

## 2. Merkle root

The Merkle root is computed over the ordered link hashes with SHA-256. At each level, nodes are paired left to right; an odd final node is paired with itself. The root commits to the exact set and order of all links. Self-pairing means a link list ending `[.., x]` and one ending `[.., x, x]` share a root, so the verifier also requires every link hash to be distinct; genuine links always are, since each one hashes its predecessor.

## 3. Signing key

At capture start the device generates an ECDSA P-256 keypair with WebCrypto, `extractable: false`: the private key can sign but cannot be read out, even by the application itself. On Android this maps to a Keystore key resident in the TEE with hardware attestation; the browser equivalent carries the same protocol role.

## 4. Manifest

The manifest is JSON with these top-level fields:

| Field | Content |
|---|---|
| `truthbox` | protocol version, `"1.0"` |
| `order` | `id`, one-time `nonce` issued in the seller QR at dispatch, `expectedClass`, `serialPattern` |
| `device` | user agent, platform, language |
| `capture` | start/end ISO timestamps, frame count, hash rate, `simulated` flag (synthetic camera feed), `scripted` flag (scripted demo: detection and serial injected, not observed) |
| `steps` | append-only log of the five capture steps with per-step evidence and the frame index at which each completed |
| `vision` | detection engine and best detection `{label, score}` |
| `ocr` | OCR engine, serial candidates, matched serial, confidence |
| `video` | SHA-256, byte size and MIME type of the recorded proof video, or null |
| `snapshots` | JPEG stills captured at the seal, reveal and label steps as data URLs, each with its SHA-256; covered by the signature |
| `chain` | algorithm string, genesis, head, Merkle root, full link list |
| `verdict` | seal, SKU-match, serial-match booleans, QR-calibrated `dimensionCheck` (`pass` / `fail` / `unknown`) and overall `VERIFIED` / `FLAGGED` |
| `signature` | `alg`, public key JWK, base64 ECDSA signature |

## 5. Signature

The signed payload is the manifest with the `signature` field removed, serialized as canonical JSON: object keys sorted lexicographically at every depth, no insignificant whitespace, arrays in order. The signature is ECDSA P-256 with SHA-256 over the UTF-8 bytes of that serialization.

Details an independent implementation must match exactly:

- Keys are compared by UTF-16 code units (the default JavaScript sort), not by code point.
- Strings and numbers are written exactly as ECMAScript `JSON.stringify` writes them: shortest round-trip number form (`1e+21`, `0.30000000000000004`), `-0` as `0`, non-ASCII characters unescaped.
- `signature.value` is standard base64 (with padding) of the raw 64-byte `r || s` signature (IEEE P1363, as WebCrypto produces), not a DER-encoded signature.
- `signature.publicKeyJwk` is a JWK with `kty: "EC"`, `crv: "P-256"` and base64url `x` and `y` coordinates.

The verdict, timestamps, order binding, nonce, chain and video hash are all inside the signed payload. Nothing about the capture can be upgraded, backdated or rebound after signing.

## 6. Verification algorithm

A verifier MUST:

1. Check `chain.links` is non-empty and every link is well formed: `h` is 64 lowercase hex digits and `m` is a finite number.
2. Check `links[i].m <= links[i+1].m` for all i (monotonic clock).
3. Check `chain.head == links[last].h`.
4. Check every link hash is distinct, then recompute the Merkle root from the link hashes; check equality with `chain.merkleRoot`.
5. Import `signature.publicKeyJwk`, rebuild the canonical JSON of the manifest without `signature`, verify the ECDSA signature.

All five checks pass or the manifest is rejected. The verifier runs offline; no Truthbox service is consulted.

## 7. Trust boundaries and known limits of v1

- The verifier proves the manifest is exactly what the capturing device signed. Binding the key to a specific physical device requires hardware attestation (Android Keystore + Play Integrity), which the web build cannot reach; the production Android app closes this gap.
- Frame hashes commit to the frames but the manifest ships without frame bytes; the proof video allows spot re-hashing in a dispute.
- The one-time nonce prevents replaying an old capture against a new order; the seller must record the nonce it issued at dispatch.
- A buyer can film a staged scene. Truthbox does not claim to detect all fraud; it removes the evidence vacuum in which cheap fraud thrives, and raises the cost of fraud from "edit a video" to "defeat live on-device vision during a continuous attested capture".
