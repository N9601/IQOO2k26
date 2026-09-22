# Truthbox

AR-verified unboxing to eliminate return fraud in Indian D2C commerce.

Return fraud costs Indian D2C brands an estimated Rs 3,500 Cr per year. Empty-box claims, item swaps, serial substitution and inflated damage claims are undetectable after the fact because no trustworthy evidence exists from the moment the parcel was opened. Truthbox turns the 30 seconds of unboxing into signed, verifiable, dispute-ready evidence, with every sensitive byte processed on the buyer's device.

## What it does

1. **Guided capture.** The buyer opens the parcel on camera. A step-driven overlay walks them through seal check, opening, item reveal and label capture. No skippable steps.
2. **On-device vision.** Object detection locates the item in frame and OCR reads serial, batch and MRP labels. Inference runs entirely on the device. No frame ever leaves the phone.
3. **Cryptographic chain of custody.** Every captured frame is hashed into a chain: `SHA-256(frame || timestamp || prevHash)`. A Merkle root is computed over the full sequence and signed with a non-extractable ECDSA P-256 key. Any post-hoc edit, insertion or removal of a frame invalidates the proof.
4. **Signed manifest.** A compact JSON manifest (hashes, detections, OCR fields, timing, signature, public key) is exported to the seller. Anyone can verify it independently, offline, in a browser.
5. **Seller dashboard.** Order QR generation, manifest ingestion, verification status and fraud analytics.

## Try it

Static site, no build step, no server-side code.

```
python -m http.server 8080
```

Then open http://localhost:8080 on a phone or laptop.

- `capture.html` - buyer-side guided unboxing capture
- `verify.html` - drop a manifest, verify the signature and hash chain; edit one byte and watch it fail
- `dashboard.html` - seller portal: orders, QR labels, verification analytics

## Architecture

```
Capture              Understand           Verify                Sign                  Deliver
getUserMedia   -->   TF.js detection  --> rule engine vs   --> Merkle root +     --> signed manifest
frame throttle       Tesseract.js OCR     order record         ECDSA P-256           JSON download
                     (all on-device)                           (WebCrypto,
                                                               non-extractable key)
```

Everything left of the signature stays on the device: raw frames, detection tensors, OCR crops. Only the signed manifest, a few kilobytes, crosses the boundary to the seller.

## Threat model

| Attack | Mitigation |
|---|---|
| Frame injection or removal | Hash chain breaks at the edited link |
| Post-hoc manifest edit | Merkle root changes, signature no longer verifies |
| Replay of an old capture | Manifest bound to the per-order nonce in the seller QR |
| Clock rollback | Monotonic performance clock deltas recorded per frame |
| Fabricated manifest | Signature verification fails without the capture key |

## Roadmap

The production target is a native Android app: CameraX + ARCore Depth for dimensional checks, PaliGemma via MediaPipe for SKU visual match, and Android Keystore hardware attestation with Play Integrity. This web MVP implements the identical evidence pipeline with browser equivalents so the protocol, manifest schema and verifier are final and portable.
