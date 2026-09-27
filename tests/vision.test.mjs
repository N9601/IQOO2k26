/*
 * The vision wrappers depend on CDN-loaded globals. When those fail to
 * load (offline first visit, blocked CDN) the loaders must reject, not
 * throw, so the capture page can fall back to manual confirmation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDetector, detect } from "../js/detect.js";
import { loadOcr } from "../js/ocr.js";

test("loaders reject when their runtime global is missing", async () => {
  assert.equal(typeof globalThis.cocoSsd, "undefined");
  assert.equal(typeof globalThis.Tesseract, "undefined");
  const pending = [loadDetector(), loadOcr()];
  await assert.rejects(pending[0], ReferenceError);
  await assert.rejects(pending[1], ReferenceError);
});

test("detect returns no predictions while no model is loaded", async () => {
  assert.deepEqual(await detect({}), []);
});
