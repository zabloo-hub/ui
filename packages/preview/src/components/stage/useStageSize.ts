/**
 * The two halves of "who tells whom how big things are", which are opposite
 * directions and must not be confused.
 *
 * DOWN — {@link useStageSize}: the browser measures the stage and the store
 * hears about it. `zoom` and the `fit` caption are derived from that number, so
 * it has to be the box the frame is actually centred in — the area BELOW the
 * caption, not the whole stage. Measured against the whole thing, a viewport
 * whose height is the binding constraint would scale to 100% of the stage and
 * push the caption off the top of the screen.
 *
 * UP — {@link useGeometryResize}: the canvas's geometry changed and the renderer
 * is listening for exactly one thing (`window`'s `resize`, then a re-read of the
 * canvas's `clientWidth` and of where its rect is — see `renderer-web/src`).
 *
 * Both halves of that geometry count, and for a while only one did (ZAB-108).
 * The LOGICAL size is what the view is laid out at, and covers every size change
 * the window never hears about — collapsing the console, entering zen, picking
 * another preset. The ZOOM is what it is drawn at, and the renderer cannot see
 * it either: it maps a click through the canvas's rect, so a scale it was never
 * told about puts every control some 20% away from where it is drawn. Collapsing
 * the console under a fixed preset changes the zoom alone, and the window says
 * nothing about it — which is exactly the case this covers.
 *
 * A window resize under a preset does move the zoom, so it comes back to the
 * renderer as one more `resize` after its own. That echo is cheap on purpose —
 * the renderer re-reads a rect and paints a frame, and leaves the backing store
 * alone when the size did not move — and there is no signal here that would tell
 * an echo from the changes only this side can see.
 */

import { type RefObject, useEffect, useRef } from "react";
import { type Size, useStore } from "@/store";

/** What the renderer has been told the canvas is: its layout box and its scale. */
interface Geometry extends Size {
  zoom: number;
}

/** Put the ref on the box the frame lives in; the store gets its size. */
function useStageSize(): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const setStageSize = useStore((state) => state.setStageSize);

  useEffect(() => {
    const area = ref.current;
    if (area === null) return;
    // A `ResizeObserver` and not a `resize` listener: the stage changes size
    // without the window doing anything at all, which is most of the cases here.
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setStageSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, [setStageSize]);

  return ref;
}

/** One `resize` per change of size or zoom — and none for the first one. */
function useGeometryResize(size: Size, zoom: number): void {
  const { width, height } = size;
  // What was last ANNOUNCED, in a ref rather than deps, so that the mount itself
  // is silent (nothing changed yet, and the canvas is only just registered) and
  // so StrictMode's second mount in development does not invent an event.
  const announced = useRef<Geometry | null>(null);

  useEffect(() => {
    const last = announced.current;
    announced.current = { width, height, zoom };
    if (last === null) return;
    if (last.width === width && last.height === height && last.zoom === zoom) return;
    window.dispatchEvent(new Event("resize"));
  }, [width, height, zoom]);
}

export { useGeometryResize, useStageSize };
