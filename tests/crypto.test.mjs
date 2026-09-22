/*
 * Tests for the chain-of-custody core. Runs on plain Node 20+ with
 * `npm test`: the same WebCrypto, TextEncoder and performance globals
 * exist in Node and the browser, so the exact file the app ships is
 * what gets tested.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sha256, hex, unhex, canonicalJson, HashChain, merkleRoot,
  generateSigningKey, signManifest, verifyManifest,
} from "../js/crypto.js";

test("sha256 matches a known vector", async () => {
  const h = hex(await sha256(new TextEncoder().encode("abc")));
  assert.equal(h, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("hex and unhex roundtrip", () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 255]);
  assert.deepEqual(unhex(hex(bytes)), bytes);
});

test("canonicalJson sorts keys at every depth", () => {
  const a = canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 4, y: 5 }] } });
  const b = canonicalJson({ a: { c: [3, { y: 5, z: 4 }], d: 2 }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":[3,{"y":5,"z":4}],"d":2},"b":1}');
});

test("hash chain: every link depends on the previous one", async () => {
  const chain = new HashChain();
  const frame = new Uint8Array(64).fill(7);
  await chain.add(frame);
  await chain.add(frame);
  await chain.add(frame);
  assert.equal(chain.length, 3);
  // Same frame bytes, different hashes: the chain and clocks feed in.
  assert.notEqual(chain.links[0].h, chain.links[1].h);
  assert.notEqual(chain.links[1].h, chain.links[2].h);
  assert.equal(hex(chain.head), chain.links[2].h);
});

test("merkle root is order-sensitive and deterministic", async () => {
  const hashes = [];
  for (let i = 0; i < 5; i++) hashes.push(hex(await sha256(new Uint8Array([i]))));
  const root1 = await merkleRoot(hashes);
  const root2 = await merkleRoot(hashes);
  assert.equal(root1, root2);
  const swapped = [...hashes];
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.notEqual(await merkleRoot(swapped), root1);
});

async function buildSignedManifest() {
  const chain = new HashChain();
  const frame = new Uint8Array(256);
  for (let i = 0; i < 12; i++) {
    frame.fill(i);
    await chain.add(frame);
  }
  const key = await generateSigningKey();
  const manifest = {
    truthbox: "1.0",
    order: { id: "TB-TEST", nonce: "ab12", expectedClass: "book", serialPattern: "X" },
    capture: { startedAt: "s", completedAt: "c", frameCount: 12, hashRateFps: 5, simulated: true },
    steps: [],
    vision: {},
    ocr: null,
    video: null,
    snapshots: { seal: { jpeg: "data:image/jpeg;base64,QUJD", sha256: "00" } },
    chain: {
      algo: "SHA-256(frame || wallMs || monoMs || prev)",
      genesis: "0".repeat(64),
      head: chain.links[chain.links.length - 1].h,
      merkleRoot: await merkleRoot(chain.links.map((l) => l.h)),
      links: chain.links,
    },
    verdict: { overall: "VERIFIED" },
  };
  manifest.signature = {
    alg: "ECDSA-P256-SHA256",
    publicKeyJwk: key.publicKeyJwk,
    value: await signManifest(manifest, key.privateKey),
  };
  return manifest;
}

test("a signed manifest verifies clean", async () => {
  const m = await buildSignedManifest();
  const { ok, results } = await verifyManifest(m);
  assert.equal(ok, true, JSON.stringify(results, null, 2));
  assert.equal(results.length, 5);
});

test("editing any field breaks the signature", async () => {
  for (const mutate of [
    (m) => { m.verdict.overall = "FLAGGED"; },
    (m) => { m.order.id = "TB-OTHER"; },
    (m) => { m.capture.startedAt = "backdated"; },
    (m) => { m.snapshots.seal.jpeg = "data:image/jpeg;base64,WFla"; },
  ]) {
    const m = await buildSignedManifest();
    mutate(m);
    const { ok, results } = await verifyManifest(m);
    assert.equal(ok, false);
    assert.equal(results.find((r) => r.check === "ECDSA signature").ok, false);
  }
});

test("editing a frame hash breaks the merkle root", async () => {
  const m = await buildSignedManifest();
  const link = m.chain.links[5];
  link.h = link.h.slice(0, -1) + (link.h.endsWith("0") ? "1" : "0");
  const { ok, results } = await verifyManifest(m);
  assert.equal(ok, false);
  assert.equal(results.find((r) => r.check === "Merkle root").ok, false);
});

test("removing middle frames is caught by the merkle root", async () => {
  // Removing frames from the middle leaves the final link intact, so the
  // head check alone would miss it. The merkle root commits to every frame,
  // so it catches the removal. This is why the root exists on top of the chain.
  const m = await buildSignedManifest();
  m.chain.links.splice(4, 4);
  const { ok, results } = await verifyManifest(m);
  assert.equal(ok, false);
  assert.equal(results.find((r) => r.check === "Merkle root").ok, false);
});

test("removing the final frame breaks the chain head", async () => {
  const m = await buildSignedManifest();
  m.chain.links.pop();
  const { ok, results } = await verifyManifest(m);
  assert.equal(ok, false);
  assert.equal(results.find((r) => r.check === "Chain head").ok, false);
});

test("clock rollback is detected", async () => {
  const m = await buildSignedManifest();
  m.chain.links[6].m = m.chain.links[5].m - 100;
  const { results } = await verifyManifest(m);
  assert.equal(results.find((r) => r.check === "Monotonic clock").ok, false);
});
