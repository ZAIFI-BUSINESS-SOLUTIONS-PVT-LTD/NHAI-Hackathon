import type { Frame } from 'react-native-vision-camera';
import type { TfliteModel } from 'react-native-fast-tflite';
import type { BoundingBox } from './faceDetection';

const INPUT_SIZE = 112;

// Crop the detected face region from the frame, resize to 112×112,
// and normalize pixel values to [-1, 1] (MobileFaceNet convention).
function cropAndResize(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  rowStride: number,
  box: BoundingBox,
): Float32Array {
  'worklet';
  const cropX = Math.floor(box.x * srcW);
  const cropY = Math.floor(box.y * srcH);
  const cropW = Math.max(1, Math.floor(box.width  * srcW));
  const cropH = Math.max(1, Math.floor(box.height * srcH));
  const xScale = cropW / INPUT_SIZE;
  const yScale = cropH / INPUT_SIZE;

  const out = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
  for (let y = 0; y < INPUT_SIZE; y++) {
    const sy = Math.min(cropY + Math.floor(y * yScale), srcH - 1);
    for (let x = 0; x < INPUT_SIZE; x++) {
      const sx = Math.min(cropX + Math.floor(x * xScale), srcW - 1);
      const si = sy * rowStride + sx * 3;
      const di = (y * INPUT_SIZE + x) * 3;
      out[di]     = src[si]     / 127.5 - 1.0;
      out[di + 1] = src[si + 1] / 127.5 - 1.0;
      out[di + 2] = src[si + 2] / 127.5 - 1.0;
    }
  }
  return out;
}

// Run MobileFaceNet on the face crop and return a 128-dim embedding.
// Must be called after the quality gate passes.
export function runFaceEmbedding(
  frame: Frame,
  box: BoundingBox,
  model: TfliteModel,
): Float32Array | null {
  'worklet';
  const buf    = frame.getPixelBuffer();
  const pixels = new Uint8Array(buf);
  const input  = cropAndResize(
    pixels,
    frame.width,
    frame.height,
    frame.bytesPerRow,
    box,
  );

  const outputs   = model.runSync([input.buffer as ArrayBuffer]);
  const embedding = new Float32Array(outputs[0]);

  if (embedding.length !== 128) return null;

  return embedding;
}

// Call this from the JS thread (via runOnJS) to log the embedding
// during the first few frames. Prints the first 8 values.
let _logCount = 0;

export function debugLogEmbedding(embedding: Float32Array): void {
  if (_logCount >= 3) return;
  _logCount += 1;
  const preview = Array.from(embedding.slice(0, 8))
    .map(v => v.toFixed(4))
    .join(', ');
  console.log(
    `[FaceEmbedding] frame=${_logCount} norm=${l2Norm(embedding).toFixed(4)} [0..7]=[${preview}]`,
  );
}

function l2Norm(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
}
