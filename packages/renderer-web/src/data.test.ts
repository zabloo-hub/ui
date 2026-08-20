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

describe("DataStore — the descendant index (ZAB-73)", () => {
  it("drops only what hangs off the path, however deep the store is", () => {
    const store = new DataStore();
    store.set("shop.items.0.enabled", true);
    store.set("shop.items.1.enabled", true);
    store.set("shop.itemsCount", 2);
    store.set("player.gold", 100);

    store.set("shop.items", [{ enabled: false }, { enabled: false }]);

    expect(store.get("shop.items.0.enabled")).toBe(false);
    expect(store.get("shop.items.1.enabled")).toBe(false);
    // A sibling that merely shares the prefix is untouched — the separator is
    // part of the comparison here exactly as it is in `affects`.
    expect(store.get("shop.itemsCount")).toBe(2);
    expect(store.get("player.gold")).toBe(100);
  });

  it("keeps working after the same subtree is written over and over", () => {
    const store = new DataStore();
    for (const _round of Array(3).keys()) {
      store.set("shop.items", [{ enabled: false }]);
      store.set("shop.items.0.enabled", true);
      expect(store.get("shop.items.0.enabled")).toBe(true);
    }
    // The index must not have kept a dead key alive: the last array wins.
    store.set("shop.items", [{ enabled: false }]);
    expect(store.get("shop.items.0.enabled")).toBe(false);
  });

  it("forgets an intermediate write when an ancestor above it is replaced", () => {
    const store = new DataStore();
    store.set("a.b.c.d", 1);
    store.set("a.b", { c: { d: 2 } });
    expect(store.get("a.b.c.d")).toBe(2);
    // And writing the root of it all drops the middle key too, not just the leaf.
    store.set("a.b.c.d", 3);
    store.set("a", { b: { c: { d: 4 } } });
    expect(store.get("a.b.c.d")).toBe(4);
  });

  it("is emptied by `clear`, index included", () => {
    const store = new DataStore();
    store.set("shop.items.0.enabled", true);
    store.clear();
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
