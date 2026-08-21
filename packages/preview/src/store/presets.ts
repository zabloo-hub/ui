/**
 * The vocabulary of "the size the UI is laid out at" — presets, DPR, and the
 * scale rule — kept apart from the slice that holds the current choice so the
 * table can be read by a picker, a caption or a test without touching the store.
 *
 * The whole idea comes from ZAB-78: the canvas used to be `flex: 1` and took
 * whatever the window gave it, so a UI authored for 1080p could not be looked at
 * in 720p without resizing the browser, and no window shape at all answers "how
 * does this read on a console at 4K".
 */

/** A logical size in CSS pixels — what the renderer lays a view out at. */
interface Size {
  width: number;
  height: number;
}

/** The picker's values. `fit` and `custom` are the two that carry no size. */
type PresetId =
  | "fit"
  | "1080p"
  | "4k"
  | "ultrawide"
  | "steamdeck"
  | "switch"
  | "phone-portrait"
  | "phone-landscape"
  | "custom";

interface Preset {
  id: PresetId;
  /** As the menu and the stage caption say it. */
  label: string;
  /** `null` for the two that are not a fixed size: `fit` and `custom`. */
  size: Size | null;
}

/** The menu, in the order it is shown. */
const PRESETS: readonly Preset[] = [
  { id: "fit", label: "Fit window", size: null },
  { id: "1080p", label: "1080p", size: { width: 1920, height: 1080 } },
  { id: "4k", label: "4K TV", size: { width: 3840, height: 2160 } },
  { id: "ultrawide", label: "Ultrawide", size: { width: 2560, height: 1080 } },
  { id: "steamdeck", label: "Steam Deck", size: { width: 1280, height: 800 } },
  { id: "switch", label: "Switch", size: { width: 1280, height: 720 } },
  { id: "phone-portrait", label: "Phone portrait", size: { width: 390, height: 844 } },
  { id: "phone-landscape", label: "Phone landscape", size: { width: 844, height: 390 } },
  { id: "custom", label: "Custom", size: null },
];

const BY_ID = new Map(PRESETS.map((preset) => [preset.id, preset]));

/** The preset with that id — `fit` for anything unknown, never undefined. */
function preset(id: PresetId): Preset {
  return BY_ID.get(id) ?? PRESETS[0];
}

function isPresetId(value: unknown): value is PresetId {
  return typeof value === "string" && BY_ID.has(value as PresetId);
}

/** The device pixel ratio a view rasterizes at: the browser's own, or a forced one. */
type Dpr = "auto" | 1 | 2 | 3;

function isDpr(value: unknown): value is Dpr {
  return value === "auto" || value === 1 || value === 2 || value === 3;
}

/** What the custom box starts at when nobody has typed anything yet. */
const DEFAULT_CUSTOM: Size = { width: 1280, height: 720 };

/**
 * How far a fixed viewport has to shrink to fit the stage. Never above 1: a 720p
 * view blown up to fill a 4K monitor would be showing you resampling, not your UI.
 *
 * This is the one copy. It arrived from the CLI's `preview-client.ts` (ZAB-78)
 * ahead of the bridge existing; the bridge's own `viewport.ts` carried a second
 * copy inside the superseded string-based viewport model and was deleted rather
 * than adopted — the stage geometry belongs with the presets it scales.
 */
function fitScale(
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number,
): number {
  if (!(width > 0 && height > 0 && availableWidth > 0 && availableHeight > 0)) return 1;
  return Math.min(1, availableWidth / width, availableHeight / height);
}

/** `"1280x720"` as a size — `null` for anything that is not one. */
function parseSize(text: string): Size | null {
  const match = /^\s*(\d{1,5})\s*[x×*]\s*(\d{1,5})\s*$/.exec(text);
  if (match === null) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

/** The preset that IS that size, if any — how a legacy `1920x1080` finds its id. */
function presetOfSize(size: Size): Preset | null {
  return (
    PRESETS.find(
      (candidate) =>
        candidate.size !== null &&
        candidate.size.width === size.width &&
        candidate.size.height === size.height,
    ) ?? null
  );
}

export type { Dpr, Preset, PresetId, Size };
export { DEFAULT_CUSTOM, fitScale, isDpr, isPresetId, PRESETS, parseSize, preset, presetOfSize };
