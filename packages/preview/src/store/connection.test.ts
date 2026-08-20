/**
 * The three states, and the transition that is easy to get wrong: reconnecting
 * over a broken export does NOT mean everything is fine (ZAB-67).
 */

import { memoryStorage } from "./storage";
import { createPreviewStore } from "./store";

const store = () => createPreviewStore({ storage: memoryStorage() });

describe("connection", () => {
  it("starts disconnected, before anything opened a stream", () => {
    expect(store().getState().connection).toBe("disconnected");
  });

  it("goes live when the stream opens with nothing pending", () => {
    const preview = store();

    preview.getState().streamOpened();

    expect(preview.getState().connection).toBe("live");
    expect(preview.getState().lastError).toBeNull();
  });

  it("goes stale on a failed export and remembers why", () => {
    const preview = store();

    preview.getState().exportFailed("export failed: unexpected token");

    expect(preview.getState().connection).toBe("stale");
    expect(preview.getState().lastError).toBe("export failed: unexpected token");
  });

  it("reconnects into stale while the export is still broken", () => {
    const preview = store();
    preview.getState().exportFailed("boom");
    preview.getState().streamLost();

    preview.getState().streamOpened();

    expect(preview.getState().connection).toBe("stale");
  });

  it("clears the failure when an export finally lands", () => {
    const preview = store();
    preview.getState().exportFailed("boom");

    preview.getState().exportLoaded();

    expect(preview.getState()).toMatchObject({ connection: "live", lastError: null });
  });

  it("reports a lost stream over everything else", () => {
    const preview = store();
    preview.getState().exportLoaded();

    preview.getState().streamLost();

    expect(preview.getState().connection).toBe("disconnected");
  });
});
