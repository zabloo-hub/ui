/**
 * Clip math: the effective clipping region of a subtree and its translation to
 * a GL scissor box. Pure (no DOM, no GL) — the paint pass, the hit test and the
 * submission layer all resolve clipping through here, so paint and input can
 * never disagree about what is visible (decision 2026-08-11: `clip` cuts BOTH).
 */

import type { Rect } from "./layout.js";

/**
 * A clipping region: the intersection rect of every ancestor clip, plus the
 * corner radius of the INNERMOST rounded clip in that chain.
 *
 * The rect is always exact (rect ∩ rect is a rect) and drives the scissor test;
 * the radius drives the shader's rounded-box discard. Exact for the real case —
 * one rounded viewport (a ScrollView with radius) with plain clips around it.
 * With two rounded clips whose corners actually overlap, only the innermost
 * one's corners are cut: an outer corner may bleed by at most its radius. A
 * second rounded region per draw would be the fix if that ever shows up.
 */
export interface Clip extends Rect {
  /** 0 = square corners: the scissor box alone is the whole clip. */
  radius: number;
}

/** Nothing is visible through this clip (fully collapsed by the intersection). */
export function isEmptyClip(clip: Clip | null): boolean {
  return clip !== null && (!(clip.width > 0) || !(clip.height > 0));
}

/**
 * Adds a node's clip rect to the inherited region. The radius is capped to the
 * node's own half-extents (same rule as the tessellator's rounded rect), so a
 * radius larger than the box can't invert the SDF.
 */
export function intersectClip(inherited: Clip | null, rect: Rect, radius: number): Clip {
  const own = Math.max(0, Math.min(radius, rect.width * 0.5, rect.height * 0.5));
  if (inherited === null) return { ...rect, radius: own };

  const x = Math.max(inherited.x, rect.x);
  const y = Math.max(inherited.y, rect.y);
  return {
    x,
    y,
    width: Math.min(inherited.x + inherited.width, rect.x + rect.width) - x,
    height: Math.min(inherited.y + inherited.height, rect.y + rect.height) - y,
    // Innermost rounded clip wins; a square inner clip keeps the ancestor's.
    radius: own > 0 ? own : inherited.radius,
  };
}

/**
 * Is the point visible through the clip? The rounded corners are honored, which
 * is what keeps hit-testing consistent with the shader's discard: a pointer in
 * the cut corner of a rounded ScrollView must not reach the content under it.
 *
 * The radius belongs to the innermost rounded clip, whose rect the intersection
 * may have shrunk; testing the corners against the intersection rect is exact
 * whenever that rect still is the rounded one (the common case) and errs toward
 * clipping slightly more otherwise — never toward accepting hidden content.
 */
export function clipContains(clip: Clip | null, point: { x: number; y: number }): boolean {
  if (clip === null) return true;
  if (
    point.x < clip.x ||
    point.x > clip.x + clip.width ||
    point.y < clip.y ||
    point.y > clip.y + clip.height
  ) {
    return false;
  }
  const r = Math.min(clip.radius, clip.width * 0.5, clip.height * 0.5);
  if (r <= 0) return true;

  // Distance from the point to the rounded box's inner "core" rect: positive on
  // both axes only in a corner region, where the radius has to be checked.
  const dx = Math.max(clip.x + r - point.x, point.x - (clip.x + clip.width - r), 0);
  const dy = Math.max(clip.y + r - point.y, point.y - (clip.y + clip.height - r), 0);
  return dx * dx + dy * dy <= r * r;
}

/** A GL scissor box: device pixels, origin at the bottom-left of the canvas. */
export interface ScissorBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Logical-px clip rect (y down, origin top-left) → scissor box (y up, origin
 * bottom-left), snapped OUTWARD to whole device pixels so the scissor never
 * eats a pixel the shader's antialiased edge is still drawing, and clamped to
 * the canvas so a scrolled-away region can't produce a negative extent.
 */
export function scissorBox(
  clip: Clip,
  canvasWidth: number,
  canvasHeight: number,
  dpr: number,
): ScissorBox {
  const left = Math.floor(clip.x * dpr);
  const right = Math.ceil((clip.x + clip.width) * dpr);
  const top = Math.floor(clip.y * dpr);
  const bottom = Math.ceil((clip.y + clip.height) * dpr);

  const x = Math.max(0, Math.min(left, canvasWidth));
  const width = Math.max(0, Math.min(right, canvasWidth) - x);
  // Flip: the box's top edge in GL space is measured from the canvas bottom.
  const y = Math.max(0, Math.min(canvasHeight - bottom, canvasHeight));
  const height = Math.max(0, Math.min(canvasHeight - top, canvasHeight) - y);
  return { x, y, width, height };
}
