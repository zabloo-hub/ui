import { describe, expect, it } from "vitest";
import { affects, DataStore } from "./data.js";

describe("DataStore — paths are addresses, not keys", () => {
  it("reads a path back exactly as it was written (the pre-F6 contract)", () => {
    const store = new DataStore();
    store.set("player.gold", 900);
    expect(store.get("player.gold")).toBe(900);
  });

  it("walks into the value the game pushed — what an item binding resolves to", () => {
    const store = new DataStore();
    store.set("shop.items", [{ name: "Poción" }, { name: "Espada", price: { amount: 12 } }]);
    expect(store.get("shop.items.0.name")).toBe("Poción");
    expect(store.get("shop.items.1.price.amount")).toBe(12);
  });

  it("gives undefined for anything missing instead of throwing", () => {
    const store = new DataStore();
    store.set("shop.items", [{ name: "Poción" }]);
    expect(store.get("shop.items.9.name")).toBeUndefined();
    expect(store.get("shop.items.0.price.amount")).toBeUndefined();
    expect(store.get("nothing.here")).toBeUndefined();
    expect(store.get("")).toBeUndefined();
  });

  it("does not confuse a sibling whose name starts the same", () => {
    const store = new DataStore();
    store.set("shop.items", [{ name: "Poción" }]);
    store.set("shop.itemsCount", 1);
    expect(store.get("shop.itemsCount")).toBe(1);
  });

  it("lets a deeper write shadow the value it was made into", () => {
    const store = new DataStore();
    const items = [{ enabled: false }];
    store.set("shop.items", items);
    store.set("shop.items.0.enabled", true);
    expect(store.get("shop.items.0.enabled")).toBe(true);
    // The game's array is not mutated: it owns its data, and the write already
    // reached it through onDataChanged.
    expect(items[0].enabled).toBe(false);
  });

  it("drops what was written under a path when that path is replaced", () => {
    const store = new DataStore();
    store.set("shop.items", [{ enabled: false }]);
    store.set("shop.items.0.enabled", true);
    store.set("shop.items", [{ enabled: false }]);
    expect(store.get("shop.items.0.enabled")).toBe(false);
  });
});

describe("affects — which bindings a write moves", () => {
  it("matches the exact path", () => {
    expect(affects("player.gold", "player.gold")).toBe(true);
  });

  it("matches downwards: a new array moves every binding inside it", () => {
    expect(affects("shop.items", "shop.items.3.name")).toBe(true);
  });

  it("matches upwards: a write inside the array moves a binding on the array", () => {
    expect(affects("shop.items.3.enabled", "shop.items")).toBe(true);
  });

  it("does not match a sibling that merely shares a prefix", () => {
    expect(affects("shop.items", "shop.itemsCount")).toBe(false);
    expect(affects("shop.itemsCount", "shop.items")).toBe(false);
  });
});
