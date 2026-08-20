/** The canvas handoff: the Stage registers it, the session picks it up. */

import { memoryStorage } from "./storage";
import { createPreviewStore } from "./store";

describe("runtime", () => {
  it("holds the canvas the Stage registers, and lets go on unmount", () => {
    const store = createPreviewStore({ storage: memoryStorage() });
    const canvas = document.createElement("canvas");

    store.getState().setCanvas(canvas);
    expect(store.getState().runtime.canvas).toBe(canvas);

    store.getState().setCanvas(null);
    expect(store.getState().runtime.canvas).toBeNull();
  });
});
