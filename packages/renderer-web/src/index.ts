/**
 * @zabloo/renderer-web — the zabloo self-renderer for the browser.
 *
 * Consumes IR envelopes and renders them to a WebGL2 canvas with the renderer's
 * OWN layout pass, tessellation and glyph atlas — the browser is just another
 * engine target (decision 2026-07-09). Seed of the visual editor's WYSIWYG
 * canvas; today it powers the `zabloo dev` live preview.
 */

export {
  type ClipSnapshot,
  type LayerSnapshot,
  type LineSnapshot,
  type NodeSnapshot,
  type RectSnapshot,
  serializeSnapshot,
  type TextSnapshot,
  type ViewSnapshot,
} from "./snapshot.js";
export { type MountOptions, mount, type ZablooHandle } from "./view.js";
