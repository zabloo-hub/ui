/**
 * What the OLD preview page left in `localStorage`, read once so that nobody who
 * had the preview configured loses it the day the new chrome ships.
 *
 * The page this replaces stored three loose strings — `zabloo.preview.viewport`
 * ("fit" | "1920x1080" | "1280x720" | "custom"), `zabloo.preview.custom` ("1280x720")
 * and `zabloo.preview.dpr` ("auto" | "1" | "2" | "3"). The store keeps ONE blob
 * under `zabloo.preview` instead, so these keys are only ever READ, and only
 * while the blob is missing: they seed the initial state, and `persist` overwrites
 * whatever it has on top. From the first save onwards the old keys are dead
 * weight, left where they are rather than deleted — removing state written by a
 * version someone may still run is not our call to make.
 */

import {
  DEFAULT_CUSTOM,
  type Dpr,
  isPresetId,
  type PresetId,
  parseSize,
  presetOfSize,
  type Size,
} from "./presets";
import { NAMESPACE, type PreviewStorage } from "./storage";

interface LegacyViewport {
  preset: PresetId;
  custom: Size;
  dpr: Dpr;
}

function readLegacyViewport(storage: PreviewStorage): LegacyViewport {
  return {
    preset: legacyPreset(storage.read(`${NAMESPACE}.viewport`)),
    custom: parseSize(storage.read(`${NAMESPACE}.custom`) ?? "") ?? DEFAULT_CUSTOM,
    dpr: legacyDpr(storage.read(`${NAMESPACE}.dpr`)),
  };
}

/**
 * The old select's value as a preset id. Its two fixed sizes are both presets of
 * the new table (1920×1080 is `1080p`, 1280×720 is `switch`), so they are matched
 * BY SIZE rather than by a hardcoded pair — which also rescues a value hand-set
 * to some other resolution instead of silently dropping it to `fit`.
 */
function legacyPreset(raw: string | null): PresetId {
  if (raw === null) return "fit";
  if (isPresetId(raw)) return raw;
  const size = parseSize(raw);
  if (size === null) return "fit";
  return presetOfSize(size)?.id ?? "custom";
}

function legacyDpr(raw: string | null): Dpr {
  const dpr = Number(raw);
  return dpr === 1 || dpr === 2 || dpr === 3 ? dpr : "auto";
}

export type { LegacyViewport };
export { readLegacyViewport };
