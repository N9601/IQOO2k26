# Truthbox

[![CI](https://github.com/N9601/IQOO2k26/actions/workflows/ci.yml/badge.svg)](https://github.com/N9601/IQOO2k26/actions/workflows/ci.yml)

AR-verified unboxing to eliminate return fraud in Indian D2C commerce.

Return fraud costs Indian D2C brands an estimated Rs 3,500 Cr per year. Empty-box claims, item swaps, serial substitution and inflated damage claims are undetectable after the fact because no trustworthy evidence exists from the moment the parcel was opened. Truthbox turns the 30 seconds of unboxing into signed, verifiable, dispute-ready evidence, with every sensitive byte processed on the buyer's device.

## What it does

1. **Guided capture.** The buyer opens the parcel on camera. A step-driven overlay walks them through seal check, opening, item reveal and label capture. No skippable steps.
2. **On-device vision.** Object detection locates the item in frame and OCR reads serial, batch and MRP labels. Inference runs entirely on the device. No frame ever leaves the phone.
3. **Cryptographic chain of custody.** Every captured frame is hashed into a chain: `SHA-256(frame || timestamp || prevHash)`. A Merkle root is computed over the full sequence and signed with a non-extractable ECDSA P-256 key. Any post-hoc edit, insertion or removal of a frame invalidates the proof.
4. **Signed manifest.** A compact JSON manifest (hashes, detections, OCR fields, timing, signature, public key) is exported to the seller. Anyone can verify it independently, offline, in a browser.
5. **Seller dashboard.** Order QR generation, manifest ingestion, verification status and fraud analytics.

## Try it

Live: https://n9601.github.io/IQOO2k26/

Or locally (static site, no build step, no server-side code):

```
python -m http.server 8080
```

Then open http://localhost:8080 on a phone or laptop.

- `capture.html` - buyer-side guided unboxing capture (English and Hindi)
- `verify.html` - drop a manifest or open a verification link; edit one byte and watch it fail
- `dashboard.html` - seller portal: QR labels with SKU dimensions, returns funnel, manifest inbox
- `intel.html` - cross-brand repeat-offender clustering over salted claimant hashes

## Feature map

| Feature | How it works |
|---|---|
| Guided five-step capture | Seal, open, reveal, label, sign. Minimum dwell per step, no skipping |
| Frame hash chain | SHA-256(frame, wall clock, monotonic clock, prev) at 5 fps, live ticker |
| On-device detection | COCO-SSD (TF.js), auto-advances when the ordered SKU class is seen |
| Label OCR | Tesseract.js reads serials, cross-checked against the order pattern |
| Dispatch QR scan | jsQR binds order, nonce, SKU class and serial pattern in one scan |
| Dimensional check | The printed QR's known size calibrates px-per-mm; the detected item is measured against SKU dimensions |
| Signed snapshots | JPEG stills at seal, reveal and label, hashed inside the signed manifest |
| Proof video | MediaRecorder capture, SHA-256 in the manifest |
| Signing | Non-extractable ECDSA P-256 via WebCrypto over canonical JSON |
| Verification | Five independent checks, chain visualizer, tamper lab with five attacks |
| Verification links | Manifest gzip-compressed into a URL fragment, verified on open, never sent to a server |
| Dispute report | Print-ready evidence record with photos and cryptographic anchors |
| Fraud intelligence | Claims clustered by salted claimant hash across brands, risk-weighted by spread |
| PWA | Installable, offline after first load, own files network-first |

## Demo script (3 minutes)

1. **Seller portal.** Open the dashboard, generate a dispatch QR for an order. Point out the one-time nonce that defeats replay attacks.
2. **Verified unboxing.** Scan the QR with a phone (or open the link). The capture flow opens bound to that order. Walk the five steps: seal check, opening, item reveal (live on-device detection draws the bounding box), label OCR, sign. The ticker at the bottom shows frames being hashed into the chain in real time.
3. **The manifest.** Download the signed manifest. Open the verifier, drop it in: five green checks, including a recomputed Merkle root and a valid ECDSA P-256 signature.
4. **The kill shot.** In the tamper lab, click "Change the serial that was read". Verification flips to EVIDENCE REJECTED instantly. Try "Silently remove 10 frames": the Merkle root breaks. Restore the original: green again. This is why a Truthbox manifest settles disputes and a WhatsApp video does not.

No camera available? The capture page drops into a clearly labeled simulation mode with a synthetic feed; every other stage (hashing, detection, OCR, signing) runs unchanged. The verifier can also generate a genuinely signed demo manifest on the spot.

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
