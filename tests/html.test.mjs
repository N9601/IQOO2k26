/*
 * Tests for the escaping helpers that stand between untrusted manifest
 * fields and innerHTML.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, imageSrc } from "../js/html.js";

test("esc neutralizes markup in content and attribute contexts", () => {
  assert.equal(esc(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(esc("O'Reilly & Sons"), "O&#39;Reilly &amp; Sons");
});

test("esc renders null and undefined as empty and stringifies the rest", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(42), "42");
});

test("imageSrc keeps only base64 image data URLs", () => {
  const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  assert.equal(imageSrc(jpeg), jpeg);
  for (const bad of [
    'data:image/jpeg;base64,AAAA" onerror="alert(1)',
    "javascript:alert(1)",
    "https://example.com/x.jpg",
    "data:image/svg+xml;base64,PHN2Zz4=",
    42,
    null,
  ]) {
    assert.equal(imageSrc(bad), "", String(bad));
  }
});
