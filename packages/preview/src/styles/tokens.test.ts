import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The theme is CSS, so nothing typechecks it and nothing else in the suite will
 * notice a token that silently stopped resolving. This reads the real
 * `tokens.css`, hands it to jsdom as a stylesheet, and asks the browser side
 * what `--background` and friends come out as with and without `.dark` — which
 * is the whole contract V3 onwards builds against.
 *
 * Read off disk rather than through Vite's `?raw`, so the test needs no addition
 * to `types` in `tsconfig.json` to typecheck. The path is composed with
 * `node:path` and not with `new URL("./tokens.css", import.meta.url)`, which
 * Vite rewrites at transform time into a bundled asset URL — an `http://` one
 * under jsdom, which `readFileSync` will not take.
 *
 * Two jsdom facts shape what can be asserted:
 *   - custom properties are NOT inherited by descendants there, so every lookup
 *     goes through `document.documentElement` — which is fine, because `:root`
 *     and `.dark` both land on `<html>` in the real app too;
 *   - `var()` is not resolved, so the tokens are literals in `tokens.css` and
 *     the one deliberate indirection (`--ring`) is asserted as the text it is.
 *
 * The visual check is the kit page (V17); this only guards the values.
 */

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tokens.css"), "utf8");

/** Light, then dark. Straight from the table in `README.md`. */
const EXPECTED: Record<string, [light: string, dark: string]> = {
  "--background": ["#fafafa", "#09090b"],
  "--card": ["#ffffff", "#18181b"],
  "--stage": ["#f4f4f5", "#09090b"],
  "--border": ["#e4e4e7", "#27272a"],
  "--foreground": ["#09090b", "#fafafa"],
  "--muted-foreground": ["#71717a", "#a1a1aa"],
  // The zinc theme's Primary is near-black in light and near-white in dark; if
  // this ever reads as the indigo, the mapping went wrong.
  "--primary": ["#09090b", "#fafafa"],
  "--primary-foreground": ["#fafafa", "#09090b"],
  "--indigo": ["#4f46e5", "#818cf8"],
  "--indigo-soft": ["#eef2ff", "rgba(129, 140, 248, 0.12)"],
  "--ok-fg": ["#3f9152", "#6ee7a0"],
  "--warn-fg": ["#96690f", "#fbbf24"],
  "--danger-fg": ["#b91c1c", "#f87171"],
};

/** Declared in `:root` on purpose and never overridden in `.dark`. */
const LIGHT_ONLY = ["--ring", "--radius"];

/** Nothing may exist only in dark: light is the default and has to be complete. */
const DARK_ONLY: string[] = [];

function declarationsIn(selector: RegExp): string[] {
  const body = source.match(selector)?.[1];
  if (!body) throw new Error(`tokens.css: no block matched ${selector}`);
  return [...body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[a-z0-9-]+)\s*:/g)].map(
    ([, name]) => name,
  );
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

describe("theme tokens", () => {
  beforeAll(() => {
    const style = document.createElement("style");
    style.textContent = source;
    document.head.append(style);
  });

  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("resolves the palette in light, which is the default", () => {
    for (const [name, [light]] of Object.entries(EXPECTED)) {
      expect(token(name), name).toBe(light);
    }
  });

  it("resolves the palette in dark once `.dark` is on the root", () => {
    document.documentElement.classList.add("dark");

    for (const [name, [, dark]] of Object.entries(EXPECTED)) {
      expect(token(name), name).toBe(dark);
    }
  });

  it("declares `color-scheme` so the native scrollbars follow the theme", () => {
    expect(token("color-scheme")).toBe("light");

    document.documentElement.classList.add("dark");
    expect(token("color-scheme")).toBe("dark");
  });

  it("leaves `--ring` pointing at `--indigo` in both themes", () => {
    // Late binding is the point: `.dark` moves the indigo and the focus border
    // follows without the token being redeclared.
    expect(token("--ring")).toBe("var(--indigo)");

    document.documentElement.classList.add("dark");
    expect(token("--ring")).toBe("var(--indigo)");
  });

  it("drops the shadow off triggers in dark, without breaking box-shadow", () => {
    expect(token("--shadow-control")).toBe("0 1px 2px rgba(0, 0, 0, 0.05)");

    document.documentElement.classList.add("dark");
    // `none` would invalidate any composed box-shadow list it landed in; a
    // fully transparent shadow is the same pixels and always parses.
    expect(token("--shadow-control")).toBe("0 0 #0000");
  });

  it("gives every token both halves of the pair", () => {
    const light = declarationsIn(/:root\s*\{([\s\S]*?)\n\}/);
    const dark = declarationsIn(/\.dark\s*\{([\s\S]*?)\n\}/);

    expect(light.filter((name) => !dark.includes(name))).toEqual(LIGHT_ONLY);
    expect(dark.filter((name) => !light.includes(name))).toEqual(DARK_ONLY);
  });
});
