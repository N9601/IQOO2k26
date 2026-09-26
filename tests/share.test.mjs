/*
 * Tests for verification links: the manifest gzip-compressed and
 * base64url-encoded into the URL fragment.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { manifestToLink, linkFragmentToManifest } from "../js/share.js";

const base = "https://example.test/verify.html";
const manifest = { truthbox: "1.0", order: { id: "TB-1", note: "हिंदी ?&#=" }, n: [1, 2.5, -3] };

test("a manifest survives the link round trip unchanged", async () => {
  const link = await manifestToLink(manifest, base);
  assert.ok(link.startsWith(base + "#m="));
  assert.deepEqual(await linkFragmentToManifest(link.slice(base.length)), manifest);
});

test("the fragment uses only URL-safe base64url characters", async () => {
  const link = await manifestToLink({ blob: "x".repeat(5000) + Math.random() }, base);
  assert.match(link.slice(base.length + 3), /^[A-Za-z0-9_-]+$/);
});

test("a fragment without a manifest resolves to null", async () => {
  for (const hash of ["", "#", "#section", "#x=abc"]) {
    assert.equal(await linkFragmentToManifest(hash), null);
  }
});

test("a truncated or corrupted link rejects instead of passing silently", async () => {
  const hash = (await manifestToLink(manifest, base)).slice(base.length);
  await assert.rejects(linkFragmentToManifest(hash.slice(0, hash.length - 12)));
  await assert.rejects(linkFragmentToManifest("#m=not*base64"));
  await assert.rejects(linkFragmentToManifest("#m=" + btoa("plain text, not gzip")));
});
