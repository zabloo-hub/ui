/**
 * The one live object the chrome shares: the canvas.
 *
 * The Stage (V10) owns the element and registers it here on mount; the session
 * (V6) is what mounts the renderer on it, and the two never meet — which is the
 * point. It is in the store rather than a ref passed down because the session is
 * a hook at the top of the tree and the canvas is created near the bottom, and
 * because "wait until there is a canvas" is then a subscription anyone can make.
 *
 * The only field here that is not serializable, and the reason `partialize` is a
 * whitelist and not a blacklist.
 */

import type { Setter } from "./state";

export interface RuntimeSlice {
  runtime: { canvas: HTMLCanvasElement | null };
  setCanvas(canvas: HTMLCanvasElement | null): void;
}

export function createRuntimeSlice(set: Setter): RuntimeSlice {
  return {
    runtime: { canvas: null },
    setCanvas: (canvas) => set({ runtime: { canvas } }),
  };
}
