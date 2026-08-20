import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Nothing typechecks CSS, so this reads the real `tokens.css`, hands it to jsdom
 * as a stylesheet, and asks what the tokens resolve to with and without `.dark`.
 *
 * Three constraints it works around: jsdom does not inherit custom properties to
 * descendants (so every lookup goes through `documentElement`, which is where
 * `:root` and `.dark` both land in the real app anyway); it does not resolve
 * `var()`; and `new URL("./x", import.meta.url)` is rewritten by Vite into an
 * asset URL that `readFileSync` will not take.
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
  // Primary is near-black / near-white. If this ever reads as the indigo, the
  // mapping went wrong.
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
    expect(token("--ring")).toBe("var(--indigo)");

    document.documentElement.classList.add("dark");
    expect(token("--ring")).toBe("var(--indigo)");
  });

  it("drops the shadow off triggers in dark, without breaking box-shadow", () => {
    expect(token("--shadow-control")).toBe("0 1px 2px rgba(0, 0, 0, 0.05)");

    document.documentElement.classList.add("dark");
    expect(token("--shadow-control")).toBe("0 0 #0000");
  });

  it("gives every token both halves of the pair", () => {
    const light = declarationsIn(/:root\s*\{([\s\S]*?)\n\}/);
    const dark = declarationsIn(/\.dark\s*\{([\s\S]*?)\n\}/);

    expect(light.filter((name) => !dark.includes(name))).toEqual(LIGHT_ONLY);
    expect(dark.filter((name) => !light.includes(name))).toEqual(DARK_ONLY);
  });
});
