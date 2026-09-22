# iQOO Hackathon 2026 submission

## Project name

Truthbox

## One-liner

AR-verified unboxing that turns the 30 seconds of opening a parcel into signed, tamper-evident, dispute-ready proof of what was inside, with no customer video ever leaving the phone.

## Problem

Return fraud costs Indian D2C brands an estimated Rs 3,500 Cr a year. Empty-box claims, item swaps, serial substitution and inflated damage claims are impossible to contest after the fact because no trustworthy evidence exists from the moment the parcel was opened. A self-recorded video proves nothing: re-encoding strips timestamps and any edit is undetectable, so dispute teams treat it as hearsay. Between 3 and 7 percent of GMV disappears before it reaches the P&L.

## Solution

Truthbox produces cryptographic evidence automatically during a guided 30-second unboxing:

1. The buyer scans the dispatch QR (which binds the order with a one-time nonce) and opens the parcel on camera through five mandatory steps: seal check, opening, item reveal, serial label, sign.
2. On-device vision (object detection and OCR) confirms the item class and reads the serial. The printed QR's known size calibrates a real-world dimensional measurement against the SKU spec. Nothing leaves the device.
3. Every frame is hashed into a chain, a Merkle root is computed over all frames, and the whole record is signed with a non-extractable ECDSA P-256 key.
4. The result is a few-kilobyte signed manifest the seller, marketplace or an insurer can verify independently, offline, with no trust in Truthbox. Any edit of a single byte makes the signature fail.

## Why it wins

- It is a difference in kind, not degree: the evidence is bound to the order before the box opens and sealed the instant it closes.
- Zero server-side compute: all AI and cryptography run in the browser, so gross margin is about 89 percent at Rs 5 per verified unboxing.
- Privacy by construction: no customer video ever leaves the phone.
- The cross-brand fraud intelligence layer catches repeat-offender rings that are invisible to any single brand.

## Live demo

https://n9601.github.io/IQOO2k26/

The Verify page has a tamper lab: generate a signed manifest, then try to fake it (change the serial, remove frames, backdate, swap a photo) and watch verification fail in real time. That interaction is the whole pitch.

## Tech

Static PWA, no backend. WebCrypto (ECDSA P-256, SHA-256), TensorFlow.js (COCO-SSD), Tesseract.js (OCR), jsQR (QR decode and dimensional calibration). Installable, works offline after first load. Chain-of-custody core is under 200 lines with an 11-test suite and CI.

## Roadmap

Native Android with ARCore Depth measurement and Android Keystore hardware attestation; a D2C pilot; marketplace and ONDC dispute-API integration; a cross-brand blacklist under differential privacy. The manifest schema and verifier built here are final and portable to that Android app unchanged.

## Repository

https://github.com/N9601/IQOO2k26 (see PROTOCOL.md for the full evidence specification).
