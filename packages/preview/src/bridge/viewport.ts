/**
 * The size a view is laid out at, and how much of it fits on screen.
 *
 * From `packages/cli/src/preview-client.ts` (ZAB-78), where the picker's value
 * was a raw string off a `<select>`. Here the presets are a union the chrome is
 * built from, and one nobody declared stops being representable.
 */

/**
 * The size a view is laid out at, which stopped being the window's (ZAB-78). The
 * canvas was `flex: 1` and took whatever the window gave it, so a UI authored for
 * 1080p could not be looked at in 720p without resizing the browser — and there is
 * no window shape at all that answers "how does this read on a console at 4K".
 */
export type Viewport = { fixed: false } | { fixed: true; width: number; height: number };

/** What the viewport picker offers, in the order it offers it. */
export const VIEWPORT_PRESETS = ["fit", "1920x1080", "1280x720", "custom"] as const;

export type ViewportPreset = (typeof VIEWPORT_PRESETS)[number];

/** Preferences outlive the page and this list, so what storage returns is checked. */
export function isViewportPreset(value: string): value is ViewportPreset {
  return (VIEWPORT_PRESETS as readonly string[]).includes(value);
}

/** The picker's value, plus whatever is in the custom box, as one viewport. */
export function parseViewport(preset: ViewportPreset, custom: string): Viewport {
  if (preset === "fit") return { fixed: false };
  const source = preset === "custom" ? custom : preset;
  const match = /^\s*(\d{1,5})\s*[x×*]\s*(\d{1,5})\s*$/.exec(source);
  if (match === null) return { fixed: false };
  const width = Number(match[1]);
  const height = Number(match[2]);
  // A half-typed "160" is not an error to shout about — it is a box mid-edit, and
  // falling back to fitting the window keeps something on screen while you type.
  if (width < 1 || height < 1) return { fixed: false };
  return { fixed: true, width, height };
}

/**
 * How far a fixed viewport has to shrink to fit the stage. Never above 1: a 720p
 * view blown up to fill a 4K monitor would be showing you resampling, not your UI.
 */
export function fitScale(
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number,
): number {
  if (!(width > 0 && height > 0 && availableWidth > 0 && availableHeight > 0)) return 1;
  return Math.min(1, availableWidth / width, availableHeight / height);
}

/** The DPR picker's value: a number to force, or undefined for the browser's own. */
export function parseDpr(value: string): number | undefined {
  const dpr = Number(value);
  return Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, 8) : undefined;
}
