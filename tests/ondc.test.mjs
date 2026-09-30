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
  const { message } = manifestToOndcIssue(manifest("VERIFIED"), "https://example.test/verify.html", true);
  assert.match(message.issue.description.short_desc, /contested/);
});

test("a FLAGGED capture supports the return claim", () => {
  const { message } = manifestToOndcIssue(manifest("FLAGGED"), null, true);
  assert.match(message.issue.description.short_desc, /supported/);
});

test("a manifest that failed verification supports neither side", () => {
  const { issue } = manifestToOndcIssue(manifest("VERIFIED"), null, false).message;
  assert.match(issue.description.short_desc, /failed integrity verification/);
  assert.equal(issue.evidence.integrity_verified, false);
});

test("the issue carries the cryptographic anchors, not the photos", () => {
  const { evidence } = manifestToOndcIssue(manifest("VERIFIED"), null, true).message.issue;
  assert.equal(evidence.integrity_verified, true);
  assert.equal(evidence.merkle_root, "ab");
  assert.equal(evidence.dispatch_nonce, "n1");
  assert.deepEqual(evidence.snapshot_hashes, { seal: "ee" });
});
