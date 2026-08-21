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
 * UP — {@link useLogicalResize}: the LOGICAL size changed, and the renderer is
 * listening for exactly one thing (`window`'s `resize`, then a re-read of the
 * canvas's `clientWidth` — see `renderer-web/src/view.ts`). Only a change of
 * what the view is laid out at is worth an event: a window resize under a fixed
 * preset changes the scale and nothing the renderer can see, and re-announcing
 * it would be the two of us handing the same event back and forth. What this
 * DOES cover is every size change the window never hears about — collapsing the
 * console, entering zen, picking another preset.
 */

import { type RefObject, useEffect, useRef } from "react";
import { type Size, useStore } from "@/store";

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

/** One `resize` per change of the logical size — and none for the first one. */
function useLogicalResize(size: Size): void {
  const { width, height } = size;
  // What was last ANNOUNCED, in a ref rather than deps, so that the mount itself
  // is silent (nothing changed yet, and the canvas is only just registered) and
  // so StrictMode's second mount in development does not invent an event.
  const announced = useRef<Size | null>(null);

  useEffect(() => {
    const last = announced.current;
    announced.current = { width, height };
    if (last === null || (last.width === width && last.height === height)) return;
    window.dispatchEvent(new Event("resize"));
  }, [width, height]);
}

export { useLogicalResize, useStageSize };
