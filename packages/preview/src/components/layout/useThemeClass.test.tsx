/**
 * The theme reaching the DOM. Both halves are asserted — the class the palette
 * keys off AND `color-scheme` — because the anti-flash script in `index.html`
 * sets the second one inline before the stylesheet exists, and an effect that
 * only moved the class would leave that inline value stale for the rest of the
 * session.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, renderHook } from "@testing-library/react";
import { createPreviewStore, memoryStorage, STORE_KEY, useStore } from "@/store";
import { useThemeClass } from "./useThemeClass";

const root = document.documentElement;

beforeEach(() => {
  useStore.setState({ theme: "light" });
  root.classList.remove("dark");
  root.style.colorScheme = "";
});

describe("useThemeClass", () => {
  it("follows the store onto <html>, both ways", () => {
    renderHook(() => useThemeClass());

    expect(root).not.toHaveClass("dark");
    expect(root.style.colorScheme).toBe("light");

    act(() => useStore.getState().setTheme("dark"));

    expect(root).toHaveClass("dark");
    expect(root.style.colorScheme).toBe("dark");

    act(() => useStore.getState().toggleTheme());

    expect(root).not.toHaveClass("dark");
    expect(root.style.colorScheme).toBe("light");
  });

  it("takes over a class the anti-flash script guessed wrong", () => {
    root.classList.add("dark");
    root.style.colorScheme = "dark";

    renderHook(() => useThemeClass());

    expect(root).not.toHaveClass("dark");
    expect(root.style.colorScheme).toBe("light");
  });
});

/**
 * The other half of the same job, and the half nothing else can catch: the script
 * in `index.html` hardcodes both the key it reads and the path into the blob, and
 * it is plain text in an HTML file that no import graph leads to. So the script is
 * pulled out of the page and run against a blob a REAL store wrote — which is what
 * makes this fail the day `persist` changes shape, rather than the morning someone
 * opens a dark preview and watches it flash white.
 *
 * The storage is handed in rather than put on the global: this environment's
 * `localStorage` is a methodless stub (Node's own web storage shadows jsdom's),
 * and injecting it is also what lets the last case be the one that matters most —
 * a storage that refuses.
 */
function runAntiFlash(storage: { getItem(key: string): string | null }): void {
  // `node:path` rather than `new URL(…, import.meta.url)`: the global `URL` in
  // here is jsdom's, and it resolves a relative path against the document's
  // http base instead of against the file one it was handed.
  const here = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(resolve(here, "../../../index.html"), "utf8");
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (match === null) throw new Error("index.html: the anti-flash script is gone");
  new Function("localStorage", match[1])(storage);
}

/** What `persist` leaves behind for the given theme, written by a real store. */
function persisted(theme: "light" | "dark"): string {
  const storage = memoryStorage();
  createPreviewStore({ storage }).getState().setTheme(theme);
  return storage.read(STORE_KEY) ?? "";
}

const holding = (raw: string | null) => ({
  getItem: (key: string) => (key === STORE_KEY ? raw : null),
});

/** A denied context: reading the property is itself the thing that raises. */
const refusing = {
  getItem: (): string => {
    throw new Error("denied");
  },
};

describe("the anti-flash script", () => {
  it("finds a remembered dark theme in what `persist` writes", () => {
    runAntiFlash(holding(persisted("dark")));

    expect(root).toHaveClass("dark");
    expect(root.style.colorScheme).toBe("dark");
  });

  it.each([
    ["a remembered light theme", holding(persisted("light"))],
    ["nothing saved yet", holding(null)],
    ["a blob edited into nonsense", holding("{oh no")],
    ["a storage that refuses to be read", refusing],
  ])("leaves the page alone for %s", (_case, storage) => {
    runAntiFlash(storage);

    expect(root).not.toHaveClass("dark");
  });
});
