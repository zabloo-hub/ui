/**
 * The data the preview holds for the game. The reconciliation is the whole test:
 * an envelope that gains and loses paths on every save must not cost you the
 * values you pushed, and a control inside a `Repeat` writes a path the envelope
 * never declared.
 */

import { inferType } from "./bindings";
import { memoryStorage } from "./storage";
import { createPreviewStore } from "./store";

const store = () => createPreviewStore({ storage: memoryStorage() });

describe("declare", () => {
  it("lists the declared paths alphabetically, whatever order they arrive in", () => {
    const preview = store();

    preview.getState().declare([
      { path: "shop.items", type: "array" },
      { path: "player.gold", type: "number" },
    ]);

    expect(preview.getState().bindings.order).toEqual(["player.gold", "shop.items"]);
    expect(preview.getState().bindings.byPath["player.gold"]).toEqual({
      path: "player.gold",
      type: "number",
      value: undefined,
      lastWriteFrom: null,
      writtenAt: null,
    });
  });

  it("keeps the value and the UI mark of a path that survives the save", () => {
    const preview = store();
    preview.getState().declare([{ path: "settings.sfx", type: "boolean" }]);
    preview.getState().setFromUI("settings.sfx", true);

    preview.getState().declare([{ path: "settings.sfx", type: "boolean" }]);

    expect(preview.getState().bindings.byPath["settings.sfx"]).toMatchObject({
      value: true,
      lastWriteFrom: "ui",
    });
  });

  it("takes the envelope's word on the type", () => {
    const preview = store();
    preview.getState().declare([{ path: "hud.count", type: "string" }]);
    preview.getState().setFromEditor("hud.count", "3");

    preview.getState().declare([{ path: "hud.count", type: "number" }]);

    expect(preview.getState().bindings.byPath["hud.count"]).toMatchObject({
      type: "number",
      value: "3",
    });
  });

  it("drops a vanished path from the panel and gives it back with its value", () => {
    const preview = store();
    preview.getState().declare([{ path: "player.gold", type: "number" }]);
    preview.getState().setFromEditor("player.gold", 1250);

    preview.getState().declare([{ path: "player.name", type: "string" }]);
    expect(preview.getState().bindings.order).toEqual(["player.name"]);

    preview.getState().declare([
      { path: "player.gold", type: "number" },
      { path: "player.name", type: "string" },
    ]);
    expect(preview.getState().bindings.byPath["player.gold"]?.value).toBe(1250);
  });
});

describe("writes", () => {
  it("marks a value the UI wrote back, with when", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:00:00Z"));
    const preview = store();
    preview.getState().declare([{ path: "settings.sfx", type: "boolean" }]);

    preview.getState().setFromUI("settings.sfx", true);

    expect(preview.getState().bindings.byPath["settings.sfx"]).toMatchObject({
      value: true,
      lastWriteFrom: "ui",
      writtenAt: Date.now(),
    });
    vi.useRealTimers();
  });

  it("clears the mark when you edit the field yourself", () => {
    const preview = store();
    preview.getState().declare([{ path: "settings.sfx", type: "boolean" }]);
    preview.getState().setFromUI("settings.sfx", true);

    preview.getState().setFromEditor("settings.sfx", false);

    expect(preview.getState().bindings.byPath["settings.sfx"]).toMatchObject({
      value: false,
      lastWriteFrom: "editor",
      writtenAt: null,
    });
  });

  it("clears the mark on its own once the highlight has been shown", () => {
    const preview = store();
    preview.getState().declare([{ path: "settings.sfx", type: "boolean" }]);
    preview.getState().setFromUI("settings.sfx", true);

    preview.getState().clearUIMark("settings.sfx");

    expect(preview.getState().bindings.byPath["settings.sfx"]).toMatchObject({
      value: true,
      lastWriteFrom: null,
      writtenAt: null,
    });
  });

  it("ignores a mark that is not there", () => {
    const preview = store();
    const before = preview.getState().bindings;

    preview.getState().clearUIMark("nobody.knows");

    expect(preview.getState().bindings).toBe(before);
  });

  it("holds a value for a path inside a Repeat, which nobody declares", () => {
    const preview = store();
    preview.getState().declare([{ path: "shop.items", type: "array" }]);

    preview.getState().setFromUI("shop.items.3.fav", true);

    expect(preview.getState().bindings.byPath["shop.items.3.fav"]).toMatchObject({
      type: "boolean",
      value: true,
    });
    // Held and replayed, but not a field in the panel: the envelope never
    // declared it, and the panel is what the envelope declares.
    expect(preview.getState().bindings.order).toEqual(["shop.items"]);
  });
});

describe("inferType", () => {
  it("reads a type off a value for the paths nobody declared", () => {
    expect(inferType(true)).toBe("boolean");
    expect(inferType(80)).toBe("number");
    expect(inferType("Aria")).toBe("string");
    expect(inferType([1, 2])).toBe("array");
    expect(inferType({ id: 1 })).toBe("object");
    expect(inferType(null)).toBe("string");
  });
});
