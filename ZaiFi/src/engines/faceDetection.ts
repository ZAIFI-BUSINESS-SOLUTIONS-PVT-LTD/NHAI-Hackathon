import type { Frame } from 'react-native-vision-camera';
import type { TfliteModel } from 'react-native-fast-tflite';

export interface BoundingBox {
  x: number;      // normalized [0, 1] -- left edge
  y: number;      // normalized [0, 1] -- top edge
  width: number;  // normalized [0, 1]
  height: number; // normalized [0, 1]
}

export interface EyeKeypoint {
  x: number; // normalized [0, 1]
  y: number; // normalized [0, 1]
}

export interface FaceDetectionResult {
  box: BoundingBox;
  score: number;
  leftEye: EyeKeypoint;
  rightEye: EyeKeypoint;
}

const INPUT_SIZE = 128;
const BOX_SCALE = 128.0;
const SCORE_THRESHOLD = 0.5;

// BlazeFace short-range anchor centers (cx, cy) normalized to [0, 1].
// Stride 8  -> 16x16 feature map, 2 anchors per cell = 512 anchors
// Stride 16 -> 8x8  feature map, 6 anchors per cell = 384 anchors
// Total: 896 anchors
function buildAnchors(): number[] {
  const a: number[] = [];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const cx = (x + 0.5) / 16;
      const cy = (y + 0.5) / 16;
      a.push(cx, cy, cx, cy);
    }
  }
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const cx = (x + 0.5) / 8;
      const cy = (y + 0.5) / 8;
      for (let k = 0; k < 6; k++) { a.push(cx, cy); }
    }
  }
  return a;
}

const ANCHORS = buildAnchors();

// Nearest-neighbor resample + normalize to [-1, 1] for BlazeFace input.
function resampleToFloat32(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  rowStride: number,
): Float32Array {
  'worklet';
  const out = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
  const xScale = srcW / INPUT_SIZE;
  const yScale = srcH / INPUT_SIZE;
  for (let y = 0; y < INPUT_SIZE; y++) {
    const srcY = Math.floor(y * yScale);
    for (let x = 0; x < INPUT_SIZE; x++) {
      const srcX = Math.floor(x * xScale);
      const si = srcY * rowStride + srcX * 3;
      const di = (y * INPUT_SIZE + x) * 3;
      out[di]     = src[si]     / 127.5 - 1.0;
      out[di + 1] = src[si + 1] / 127.5 - 1.0;
      out[di + 2] = src[si + 2] / 127.5 - 1.0;
    }
  }
  return out;
}

export function runFaceDetection(
  frame: Frame,
  model: TfliteModel,
  anchors: number[],
): FaceDetectionResult | null {
  'worklet';
  const buf = frame.getPixelBuffer();
  const pixels = new Uint8Array(buf);
  const input = resampleToFloat32(
    pixels,
    frame.width,
    frame.height,
    frame.bytesPerRow,
  );

  // outputs[0]: regressors [896 x 16]
  // outputs[1]: classificators [896 x 1] -- raw logits
  const outputs   = model.runSync([input.buffer as ArrayBuffer]);
  const regressors = new Float32Array(outputs[0]);
  const logits     = new Float32Array(outputs[1]);

  let bestScore = SCORE_THRESHOLD;
  let bestIdx   = -1;

  for (let i = 0; i < 896; i++) {
    const score = 1 / (1 + Math.exp(-logits[i]));
    if (score > bestScore) {
      bestScore = score;
      bestIdx   = i;
    }
  }

  if (bestIdx === -1) { return null; }

  const anchorCx = anchors[bestIdx * 2];
  const anchorCy = anchors[bestIdx * 2 + 1];
  const base = bestIdx * 16;

  const cx = regressors[base]     / BOX_SCALE + anchorCx;
  const cy = regressors[base + 1] / BOX_SCALE + anchorCy;
  // BlazeFace log-encodes w/h: w = exp(reg / scale)
  const w  = Math.exp(regressors[base + 2] / BOX_SCALE);
  const h  = Math.exp(regressors[base + 3] / BOX_SCALE);

  const x = Math.max(0, cx - w / 2);
  const y = Math.max(0, cy - h / 2);

  // Keypoints: index 4-5 = right eye, 6-7 = left eye (subject perspective)
  const rightEye: EyeKeypoint = {
    x: Math.max(0, Math.min(1, regressors[base + 4] / BOX_SCALE + anchorCx)),
    y: Math.max(0, Math.min(1, regressors[base + 5] / BOX_SCALE + anchorCy)),
  };
  const leftEye: EyeKeypoint = {
    x: Math.max(0, Math.min(1, regressors[base + 6] / BOX_SCALE + anchorCx)),
    y: Math.max(0, Math.min(1, regressors[base + 7] / BOX_SCALE + anchorCy)),
  };

  return {
    box: {
      x,
      y,
      width:  Math.min(w, 1 - x),
      height: Math.min(h, 1 - y),
    },
    score: bestScore,
    leftEye,
    rightEye,
  };
}

export { ANCHORS };
