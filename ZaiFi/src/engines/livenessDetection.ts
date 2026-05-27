import type { Frame } from 'react-native-vision-camera';
import type { TfliteModel } from 'react-native-fast-tflite';
import type { BoundingBox } from './faceDetection';

// MiniFASNet V2 (Silent-Face anti-spoofing)
// Input:  float32[80 × 80 × 3], normalized to [-1, 1]
// Output: float32[3] — raw logits for [spoof, real, unsure]
//         softmax(output)[1] = "real face" probability
const INPUT_W = 80;
const INPUT_H = 80;

export const LIVENESS_THRESHOLD = 0.7;

export interface LivenessResult {
  isLive: boolean;
  score: number; // [0, 1] — probability of being a real (live) face
}

// Crop the face region from the frame and resize to INPUT_W × INPUT_H.
// Pixel values are normalized to [-1, 1] (mean=0.5, std=0.5 equivalent).
function cropAndNormalize(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  rowStride: number,
  box: BoundingBox,
): Float32Array {
  'worklet';
  const cropX = Math.floor(box.x * srcW);
  const cropY = Math.floor(box.y * srcH);
  const cropW = Math.max(1, Math.floor(box.width * srcW));
  const cropH = Math.max(1, Math.floor(box.height * srcH));
  const xScale = cropW / INPUT_W;
  const yScale = cropH / INPUT_H;

  const out = new Float32Array(INPUT_W * INPUT_H * 3);
  for (let y = 0; y < INPUT_H; y++) {
    const sy = Math.min(cropY + Math.floor(y * yScale), srcH - 1);
    for (let x = 0; x < INPUT_W; x++) {
      const sx = Math.min(cropX + Math.floor(x * xScale), srcW - 1);
      const si = sy * rowStride + sx * 3;
      const di = (y * INPUT_W + x) * 3;
      out[di]     = src[si]     / 127.5 - 1.0;
      out[di + 1] = src[si + 1] / 127.5 - 1.0;
      out[di + 2] = src[si + 2] / 127.5 - 1.0;
    }
  }
  return out;
}

// Numerically stable softmax over the first 3 elements.
function softmax3(logits: Float32Array): Float32Array {
  'worklet';
  let max = logits[0];
  if (logits.length > 1 && logits[1] > max) max = logits[1];
  if (logits.length > 2 && logits[2] > max) max = logits[2];

  const e0 = Math.exp(logits[0] - max);
  const e1 = logits.length > 1 ? Math.exp(logits[1] - max) : 0;
  const e2 = logits.length > 2 ? Math.exp(logits[2] - max) : 0;
  const sum = e0 + e1 + e2;

  const result = new Float32Array(3);
  result[0] = e0 / sum;
  result[1] = e1 / sum;
  result[2] = e2 / sum;
  return result;
}

// Run MiniFASNet on the face crop and return a liveness decision.
// Must be called inside a worklet after quality gate passes.
export function runLivenessDetection(
  frame: Frame,
  box: BoundingBox,
  model: TfliteModel,
): LivenessResult {
  'worklet';
  const buf    = frame.getPixelBuffer();
  const pixels = new Uint8Array(buf);
  const input  = cropAndNormalize(
    pixels,
    frame.width,
    frame.height,
    frame.bytesPerRow,
    box,
  );

  const outputs = model.runSync([input.buffer as ArrayBuffer]);
  const logits  = new Float32Array(outputs[0]);

  // index 1 = "real/live" class probability after softmax
  const probs = softmax3(logits);
  const score = probs[1];

  return { isLive: score > LIVENESS_THRESHOLD, score };
}
