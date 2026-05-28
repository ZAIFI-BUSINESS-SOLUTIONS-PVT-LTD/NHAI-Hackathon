/**
 * blinkDetection.ts
 *
 * Active liveness challenge: detects a natural blink by tracking mean pixel
 * luminance of small eye-ROIs across a rolling 7-frame window.
 *
 * Algorithm
 * ─────────
 *  1. For each processed frame, crop a proportional ROI around each eye
 *     keypoint (supplied from BlazeFace) and compute mean BT.601 luminance.
 *  2. Average the left-eye and right-eye luminance into one combined value.
 *  3. Maintain a 7-frame rolling history; once the window is filled, compute
 *     a stable baseline (average of those frames).
 *  4. State machine:
 *       FILLING  → window not yet full; accumulate frames.
 *       WATCHING → normal; update baseline via EMA; watch for a 25% drop.
 *       DROPPING → luminance dropped below baseline × DROP_THRESH for ≥1 frame;
 *                  count consecutive drop frames.
 *       On recovery (luminance rises back): if drop lasted ≥ MIN_DROP_FRAMES
 *       → set blinkDetected = true.  Otherwise treat as noise, return to WATCHING.
 *
 * The returned BlinkState is a plain mutable object that lives in the worklet
 * closure (same pattern as captureState / throttle in AuthScreen).
 */

import type { Frame } from 'react-native-vision-camera';
import type { FaceDetectionResult } from './faceDetection';

// ── Constants ─────────────────────────────────────────────────────────────────

const WINDOW_SIZE      = 7;
const DROP_THRESH      = 0.75;  // luminance must fall below baseline × 0.75 (25% drop)
const RECOVER_THRESH   = 0.88;  // must recover to baseline × 0.88 to confirm close-then-open
const MIN_DROP_FRAMES  = 2;     // drop must last ≥ 2 frames to count as intentional blink

/** Eye ROI half-size as a fraction of the face-box dimension on the same axis. */
const EYE_ROI_HALF_W_RATIO = 0.09;  // ~18% of face width → ÷2 for half-width
const EYE_ROI_HALF_H_RATIO = 0.07;  // ~14% of face height → ÷2 for half-height
const ROI_MIN_HALF_PX = 4;          // floor: always at least 4 px radius

// Internal phase constants (avoid string comparisons in worklet hot path)
const PHASE_FILLING  = 0;
const PHASE_WATCHING = 1;
const PHASE_DROPPING = 2;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Mutable blink-detector state.  Create once with initBlinkDetector(), pass the
 * same reference into every processBlink() call.  Reset with resetBlinkDetector().
 */
export interface BlinkState {
  /** Rolling luminance history (combined L+R), length WINDOW_SIZE. */
  lumHistory: number[];
  /** Next write index into lumHistory (wraps at WINDOW_SIZE). */
  histIdx: number;
  /** How many frames have been written so far (caps at WINDOW_SIZE). */
  filledFrames: number;
  /** Stable baseline luminance (updated via EMA in WATCHING phase). */
  baseline: number;
  /** Current state-machine phase: FILLING=0, WATCHING=1, DROPPING=2. */
  phase: number;
  /** Consecutive frames where luminance stayed below DROP_THRESH. */
  dropFrames: number;
  /** Set to true once a full blink (drop + recovery) is confirmed. */
  blinkDetected: boolean;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Create a fresh BlinkState.  Call on JS thread; pass into worklet via closure. */
export function initBlinkDetector(): BlinkState {
  return {
    lumHistory:    new Array<number>(WINDOW_SIZE).fill(0),
    histIdx:       0,
    filledFrames:  0,
    baseline:      0,
    phase:         PHASE_FILLING,
    dropFrames:    0,
    blinkDetected: false,
  };
}

/** Reset all fields in-place (avoids object churn). */
export function resetBlinkDetector(state: BlinkState): void {
  for (let i = 0; i < WINDOW_SIZE; i++) state.lumHistory[i] = 0;
  state.histIdx       = 0;
  state.filledFrames  = 0;
  state.baseline      = 0;
  state.phase         = PHASE_FILLING;
  state.dropFrames    = 0;
  state.blinkDetected = false;
}

/**
 * Process one frame.  Must be called inside a worklet (frame-processor context).
 *
 * @param frame     The current camera frame (pixelFormat: 'rgb').
 * @param detection BlazeFace result for this frame, including leftEye / rightEye keypoints.
 * @param state     The mutable BlinkState shared across frames.
 * @returns         { blinkDetected: true } as soon as a blink is confirmed; false otherwise.
 */
export function processBlink(
  frame: Frame,
  detection: FaceDetectionResult,
  state: BlinkState,
): { blinkDetected: boolean } {
  'worklet';

  // Once a blink is locked in, keep returning true until reset.
  if (state.blinkDetected) return { blinkDetected: true };

  const buf    = frame.getPixelBuffer();
  const pixels = new Uint8Array(buf);
  const fw     = frame.width;
  const fh     = frame.height;
  const bpr    = frame.bytesPerRow;

  // ── Compute eye-ROI half-sizes (proportional to face box) ──────────────────
  const halfW = Math.max(
    ROI_MIN_HALF_PX,
    Math.round(detection.box.width * fw * EYE_ROI_HALF_W_RATIO),
  );
  const halfH = Math.max(
    ROI_MIN_HALF_PX,
    Math.round(detection.box.height * fh * EYE_ROI_HALF_H_RATIO),
  );

  // ── Mean luminance helpers ─────────────────────────────────────────────────
  const leftLum  = _roiLuminance(pixels, fw, fh, bpr, detection.leftEye.x,  detection.leftEye.y,  halfW, halfH);
  const rightLum = _roiLuminance(pixels, fw, fh, bpr, detection.rightEye.x, detection.rightEye.y, halfW, halfH);
  const combined = (leftLum + rightLum) * 0.5;

  // ── Update rolling window ──────────────────────────────────────────────────
  state.lumHistory[state.histIdx] = combined;
  state.histIdx = (state.histIdx + 1) % WINDOW_SIZE;
  if (state.filledFrames < WINDOW_SIZE) state.filledFrames++;

  // ── State machine ──────────────────────────────────────────────────────────

  if (state.phase === PHASE_FILLING) {
    if (state.filledFrames >= WINDOW_SIZE) {
      // Initialise baseline as simple mean of the filled window
      let sum = 0;
      for (let i = 0; i < WINDOW_SIZE; i++) sum += state.lumHistory[i];
      state.baseline = sum / WINDOW_SIZE;
      state.phase    = PHASE_WATCHING;
    }
    return { blinkDetected: false };
  }

  if (state.phase === PHASE_WATCHING) {
    if (combined < state.baseline * DROP_THRESH) {
      state.phase      = PHASE_DROPPING;
      state.dropFrames = 1;
    } else {
      // Slow exponential moving average keeps baseline tracking ambient light
      state.baseline = state.baseline * 0.95 + combined * 0.05;
    }
    return { blinkDetected: false };
  }

  // PHASE_DROPPING
  const recovered = combined >= state.baseline * RECOVER_THRESH;
  if (!recovered) {
    state.dropFrames++;
    return { blinkDetected: false };
  }

  // Luminance has recovered — was it a real blink?
  if (state.dropFrames >= MIN_DROP_FRAMES) {
    state.blinkDetected = true;
    return { blinkDetected: true };
  }

  // Too brief — probably noise; go back to watching
  state.phase      = PHASE_WATCHING;
  state.dropFrames = 0;
  state.baseline   = state.baseline * 0.95 + combined * 0.05;
  return { blinkDetected: false };
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Compute mean BT.601 luma of a rectangular ROI centred on (cxNorm, cyNorm).
 * Returns a value in [0, 1].  Clamps the ROI to frame bounds.
 */
function _roiLuminance(
  pixels:  Uint8Array,
  frameW:  number,
  frameH:  number,
  bpr:     number,
  cxNorm:  number,
  cyNorm:  number,
  halfW:   number,
  halfH:   number,
): number {
  'worklet';
  const cx = Math.round(cxNorm * frameW);
  const cy = Math.round(cyNorm * frameH);
  const x0 = Math.max(0, cx - halfW);
  const y0 = Math.max(0, cy - halfH);
  const x1 = Math.min(frameW - 1, cx + halfW);
  const y1 = Math.min(frameH - 1, cy + halfH);

  let sum   = 0;
  let count = 0;

  for (let y = y0; y <= y1; y++) {
    const rowBase = y * bpr;
    for (let x = x0; x <= x1; x++) {
      const i = rowBase + x * 3;
      // BT.601 luma: Y = 0.299·R + 0.587·G + 0.114·B
      sum += pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
      count++;
    }
  }

  return count > 0 ? sum / (count * 255) : 0;
}
