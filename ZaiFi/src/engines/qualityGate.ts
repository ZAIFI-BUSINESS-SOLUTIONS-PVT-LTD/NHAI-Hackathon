import type { BoundingBox } from './faceDetection';

export interface QualityResult {
  passed: boolean;
  reason?: 'face_too_small' | 'face_off_center';
}

// Face bounding box area must be at least this fraction of the frame.
const MIN_FACE_AREA_RATIO = 0.10;

// Face center must fall within this inner band of the frame [margin, 1-margin].
// 0.20 means the center 60% of the frame is accepted.
const CENTER_MARGIN = 0.20;

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
