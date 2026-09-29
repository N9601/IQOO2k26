/*
 * Tests for the draft ONDC IGM issue mapping.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { manifestToOndcIssue } from "../js/ondc.js";

const manifest = (overall) => ({
  truthbox: "1.0",
  order: { id: "TB-1", nonce: "n1", expectedClass: "book" },
  chain: { links: [{}, {}], merkleRoot: "ab", head: "cd" },
  verdict: { overall, serial: "SN1" },
  signature: { value: "sig", publicKeyJwk: { kty: "EC" } },
  snapshots: { seal: { jpeg: "data:image/jpeg;base64,AA", sha256: "ee" } },
});

test("a VERIFIED capture contests the return claim", () => {
  const { message } = manifestToOndcIssue(manifest("VERIFIED"), "https://example.test/verify.html");
  assert.match(message.issue.description.short_desc, /contested/);
});

test("a FLAGGED capture supports the return claim", () => {
  const { message } = manifestToOndcIssue(manifest("FLAGGED"));
  assert.match(message.issue.description.short_desc, /supported/);
});

test("the issue carries the cryptographic anchors, not the photos", () => {
  const { evidence } = manifestToOndcIssue(manifest("VERIFIED")).message.issue;
  assert.equal(evidence.merkle_root, "ab");
  assert.equal(evidence.dispatch_nonce, "n1");
  assert.deepEqual(evidence.snapshot_hashes, { seal: "ee" });
});
