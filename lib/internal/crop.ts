// ============================================================================
// lib/internal/crop.ts
//
// Focal-point crop geometry.
//
// Isolated from the sharp call and from any I/O so it can be unit-tested — this
// is the one piece of the media path with real arithmetic in it, and getting it
// wrong produces subtly mis-framed images across every generated site rather
// than an error anyone would notice.
//
// MUST stay in agreement with the form's CSS preview:
//
//   .crop { aspect-ratio: var(--target); overflow: hidden; }
//   .crop img { object-fit: cover;
//               object-position: calc(var(--fx) * 100%) calc(var(--fy) * 100%); }
//
// `object-fit: cover` + percentage `object-position` is precisely the model
// below: fill the box on the constrained axis, then slide along the free axis
// so the focal point sits proportionally where the author placed it.
// ============================================================================

export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CropInput {
  sourceWidth: number;
  sourceHeight: number;
  /** Target aspect as "16/9", "4/3", "1/1". */
  aspect: string;
  /** 0..1, default centre. */
  focalX?: number;
  focalY?: number;
}

/** Parse "16/9" to 1.777…. Falls back to 16:9 on anything unparseable. */
export function parseAspect(aspect: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[/:]\s*(\d+(?:\.\d+)?)\s*$/.exec(aspect);

  if (!match) {
    const single = Number(aspect);
    return Number.isFinite(single) && single > 0 ? single : 16 / 9;
  }

  const w = Number(match[1]);
  const h = Number(match[2]);
  return h > 0 ? w / h : 16 / 9;
}

function clamp(value: number, min: number, max: number): number {
  // max < min happens when the crop equals the source on an axis; the crop
  // origin is then pinned to 0 rather than producing a negative offset.
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Largest rectangle of the target aspect that fits inside the source,
 * positioned so the focal point sits as close to proportional as the edges allow.
 *
 * Two cases:
 *   source wider than target  -> full height, crop the sides
 *   source taller than target -> full width, crop top and bottom
 *
 * The clamp is what makes edge focal points behave. A focal point at x=0.95 on
 * a wide source would want a crop origin past the right edge; clamping pins it
 * flush instead of producing transparent padding.
 */
export function computeCrop(input: CropInput): CropRect {
  const { sourceWidth: W, sourceHeight: H } = input;

  if (W <= 0 || H <= 0) {
    throw new Error(`Invalid source dimensions: ${W}x${H}`);
  }

  const target = parseAspect(input.aspect);
  const source = W / H;

  const fx = clamp(input.focalX ?? 0.5, 0, 1);
  const fy = clamp(input.focalY ?? 0.5, 0, 1);

  let cropW: number;
  let cropH: number;

  if (source > target) {
    // Source is wider: height is the constrained axis.
    cropH = H;
    cropW = Math.round(H * target);
  } else {
    // Source is taller (or equal): width is constrained.
    cropW = W;
    cropH = Math.round(W / target);
  }

  // Rounding can overshoot by a pixel; sharp rejects an extract past the edge.
  cropW = Math.min(cropW, W);
  cropH = Math.min(cropH, H);

  // Centre the crop on the focal point, then pull it back inside the source.
  const left = Math.round(clamp(fx * W - cropW / 2, 0, W - cropW));
  const top = Math.round(clamp(fy * H - cropH / 2, 0, H - cropH));

  return { left, top, width: cropW, height: cropH };
}

/**
 * Output dimensions after cropping and scaling to a target width.
 *
 * Never upscales: a 900px source asked for 2400px yields 900. The variant
 * ladder already skips widths above the source, but a build against an asset
 * whose recorded dimensions were wrong would otherwise produce a blurry upscale.
 */
export function computeOutputSize(
  crop: CropRect,
  targetWidth: number,
): { width: number; height: number } {
  const width = Math.min(targetWidth, crop.width);
  const height = Math.round(width / (crop.width / crop.height));
  return { width, height };
}