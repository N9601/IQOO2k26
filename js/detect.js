/*
 * On-device object detection via TensorFlow.js COCO-SSD.
 * All inference happens in the browser; frames never leave the device.
 * The production build swaps this for YOLOv8n on ONNX Runtime Mobile
 * with the NNAPI delegate; the interface stays the same.
 */

let model = null;
let loading = null;

export function loadDetector() {
  if (!loading) {
    loading = cocoSsd.load({ base: "lite_mobilenet_v2" }).then((m) => {
      model = m;
      return m;
    });
  }
  return loading;
}

export function detectorReady() {
  return model !== null;
}

/* Returns [{label, score, box: [x, y, w, h]}] excluding people,
 * sorted by confidence. */
export async function detect(source) {
  if (!model) return [];
  const preds = await model.detect(source, 5, 0.4);
  return preds
    .filter((p) => p.class !== "person")
    .map((p) => ({ label: p.class, score: p.score, box: p.bbox }))
    .sort((a, b) => b.score - a.score);
}
