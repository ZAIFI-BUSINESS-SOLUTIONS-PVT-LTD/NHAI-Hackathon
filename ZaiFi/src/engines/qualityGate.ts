import type { BoundingBox } from './faceDetection';

export interface QualityResult {
  passed: boolean;
  reason?: 'face_too_small' | 'face_off_center';
}

// Face bounding box area must be at least this fraction of the frame.
// 0.02 = face only needs ~14% wide x 14% tall (arm's-length on Redmi passes).
const MIN_FACE_AREA_RATIO = 0.02;

// Face center must fall within [margin, 1-margin] on each axis.
// 0.10 = centre 80% of frame accepted (was 60% with old 0.20 margin).
const CENTER_MARGIN = 0.10;

export function checkQuality(
  box: BoundingBox,
  frameWidth: number,
  frameHeight: number,
): QualityResult {
  'worklet';
  const faceArea  = box.width * frameWidth * (box.height * frameHeight);
  const frameArea = frameWidth * frameHeight;

  if (faceArea / frameArea < MIN_FACE_AREA_RATIO) {
    return { passed: false, reason: 'face_too_small' };
  }

  const cx = box.x + box.width  / 2;
  const cy = box.y + box.height / 2;

  if (
    cx < CENTER_MARGIN ||
    cx > 1 - CENTER_MARGIN ||
    cy < CENTER_MARGIN ||
    cy > 1 - CENTER_MARGIN
  ) {
    return { passed: false, reason: 'face_off_center' };
  }

  return { passed: true };
}
