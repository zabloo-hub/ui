/**
 * The vow: nothing here throws. The interesting case is not the happy path but
 * the denied one — `localStorage` that raises on every access, which is what a
 * private window or a sandboxed frame hands you.
 */

import { browserStorage, memoryStorage, NAMESPACE, stateStorage, viewKey } from "./storage";

/**
 * A working `localStorage`. Stubbed rather than borrowed from the environment on
 * purpose: the jsdom the suite runs in exposes an empty object under that name —
 * which is itself one of the shapes this module exists to survive — so the happy
 * path has to bring its own.
 */
function working(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  } as unknown as Storage;
}

/** A `localStorage` that refuses everything, the way a denied context does. */
function denied(): Storage {
  const refuse = (): never => {
    throw new Error("The operation is insecure.");
  };
  return {
    getItem: refuse,
    setItem: refuse,
    removeItem: refuse,
    clear: refuse,
    key: refuse,
    length: 0,
  } as unknown as Storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserStorage", () => {
  it("reads and writes through localStorage", () => {
    vi.stubGlobal("localStorage", working());
    const storage = browserStorage();
    storage.write(`${NAMESPACE}.theme`, "dark");

    expect(storage.read(`${NAMESPACE}.theme`)).toBe("dark");
    expect(localStorage.getItem(`${NAMESPACE}.theme`)).toBe("dark");

    storage.remove(`${NAMESPACE}.theme`);
    expect(storage.read(`${NAMESPACE}.theme`)).toBeNull();
  });

  it("reports a denied storage as absence instead of throwing", () => {
    vi.stubGlobal("localStorage", denied());
    const storage = browserStorage();

    expect(() => storage.write("k", "v")).not.toThrow();
    expect(() => storage.remove("k")).not.toThrow();
    expect(storage.read("k")).toBeNull();
  });

  it("survives a context that has no storage at all", () => {
    vi.stubGlobal("localStorage", {});
    const storage = browserStorage();

    expect(storage.read("k")).toBeNull();
    expect(() => storage.write("k", "v")).not.toThrow();
  });
});

describe("memoryStorage", () => {
  it("starts from the entries it is given", () => {
    const storage = memoryStorage({ a: "1" });

    expect(storage.read("a")).toBe("1");
    expect(storage.read("b")).toBeNull();
  });
});

describe("stateStorage", () => {
  it("hands persist the same non-throwing storage", () => {
    const adapter = stateStorage(memoryStorage());

    adapter.setItem("k", "v");
    expect(adapter.getItem("k")).toBe("v");
    adapter.removeItem("k");
    expect(adapter.getItem("k")).toBeNull();
  });
});

describe("viewKey", () => {
  it("keeps one selection per envelope", () => {
    expect(viewKey("zabloo.ir.json")).toBe("zabloo.preview.activeView:zabloo.ir.json");
    expect(viewKey("a91f0c3")).not.toBe(viewKey("zabloo.ir.json"));
  });
});
