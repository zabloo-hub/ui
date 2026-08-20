/**
 * The size the UI is laid out at, which stopped being the window's in ZAB-78,
 * plus the DPR it rasterizes at and how much of it currently fits on screen.
 *
 * Three of the four fields are remembered (★ `viewport`, `custom`, `dpr`): the
 * preset you are working at is a property of the SCREEN you are designing, not of
 * the tab, and the dev loop reloads on every save. `stageSize` is the fourth and
 * is NOT remembered — it is measured by the Stage (V10) on every mount, and a
 * stale number here would show a wrong zoom for one frame on every boot.
 *
 * Nothing in here touches the canvas; `logicalSize`, `zoom` and `captionParts`
 * in `selectors.ts` are what turn these four fields into pixels.
 */

import { readLegacyViewport } from "./legacy";
import { type Dpr, type PresetId, parseSize, type Size } from "./presets";
import type { Getter, Setter } from "./state";
import type { PreviewStorage } from "./storage";

export interface ViewportSlice {
  /** An object rather than a bare id: the picker's value is going to grow. */
  viewport: { preset: PresetId };
  /** What the `custom` preset lays out at, remembered even while another preset is on. */
  custom: Size;
  dpr: Dpr;
  /** What the Stage measured, in CSS pixels. The scale is derived from it. */
  stageSize: Size;
  setPreset(id: PresetId): void;
  setCustom(size: Size): void;
  setDpr(dpr: Dpr): void;
  setStageSize(size: Size): void;
}

export function createViewportSlice(
  set: Setter,
  get: Getter,
  storage: PreviewStorage,
): ViewportSlice {
  // Seeds only: whatever `persist` has under the new key lands on top of this.
  const legacy = readLegacyViewport(storage);
  return {
    viewport: { preset: legacy.preset },
    custom: legacy.custom,
    dpr: legacy.dpr,
    stageSize: { width: 0, height: 0 },

    setPreset: (id) => set({ viewport: { preset: id } }),

    // Deliberately does NOT switch the preset to `custom`: the menu's W×H boxes
    // are edited before "Set" is pressed, and typing a number should not yank the
    // canvas out from under the preset you are still looking at. V9 makes the
    // two calls in the order the button means.
    setCustom: (size) => {
      const valid = normalize(size);
      if (valid === null) return;
      set({ custom: valid });
    },

    setDpr: (dpr) => set({ dpr }),

    setStageSize: (size) => {
      const { stageSize } = get();
      if (stageSize.width === size.width && stageSize.height === size.height) return;
      set({ stageSize: size });
    },
  };
}

/**
 * A half-typed `160` is not an error to shout about — it is a box mid-edit — so
 * a size that makes no sense is ignored and the last good one stays. Same
 * forgiveness the old `parseViewport` showed, and the same 5-digit ceiling.
 */
function normalize(size: Size): Size | null {
  return parseSize(`${Math.floor(size.width)}x${Math.floor(size.height)}`);
}
