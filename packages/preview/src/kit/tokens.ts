/**
 * The token swatches, read off the live cascade instead of written down again.
 *
 * The whole point of the row is to answer "what is `--indigo-soft` in dark right
 * now" — a second copy of the palette in this file would answer "what did
 * someone type here", and the day `tokens.css` moves it would keep answering it,
 * confidently, with the old value.
 *
 * Both palettes come off `<html>` itself: `.dark` is removed, the eleven
 * variables are read, `.dark` is put back on, they are read again, and the class
 * is restored to whatever it was. `getComputedStyle` flushes styles
 * synchronously, so all of it happens inside one task with no paint in between —
 * the page never flickers through the other theme. Doing it on a detached probe
 * instead does not work: custom properties inherit, so a probe under a dark
 * `<html>` sees the dark palette no matter what class it wears itself.
 *
 * In jsdom there is no stylesheet and every read comes back empty; the cell
 * draws the swatch with no colour rather than pretending, and the smoke test
 * only asks that the row is there.
 */

/** The eleven pairs the artboard draws, in its order. */
const TOKENS: readonly { name: string; variable: string }[] = [
  { name: "bg", variable: "--background" },
  { name: "panel", variable: "--card" },
  { name: "stage", variable: "--stage" },
  { name: "border", variable: "--border" },
  { name: "text", variable: "--foreground" },
  { name: "muted", variable: "--muted-foreground" },
  { name: "accent", variable: "--indigo" },
  { name: "accent-soft", variable: "--indigo-soft" },
  { name: "ok", variable: "--ok" },
  { name: "warn", variable: "--warn" },
  { name: "danger", variable: "--danger" },
];

interface TokenPair {
  name: string;
  variable: string;
  light: string;
  dark: string;
}

interface TokenPalette {
  pairs: TokenPair[];
  /** The page colour each half of a swatch is painted over. See `TokensCell`. */
  surface: { light: string; dark: string };
}

/** What a swatch's halves are drawn on top of: the chrome's own background. */
const SURFACE = "--background";

/** The eleven values, plus the surface, of whichever palette `<html>` resolves. */
function readPalette(): { values: string[]; surface: string } {
  const styles = getComputedStyle(document.documentElement);
  return {
    values: TOKENS.map((token) => styles.getPropertyValue(token.variable).trim()),
    surface: styles.getPropertyValue(SURFACE).trim(),
  };
}

/**
 * Both palettes, in one synchronous pass. Exported for its own test as much as
 * for the cell: the class has to come back exactly as it was found, including
 * the case where the kit is being read in dark.
 */
function readTokenPairs(): TokenPalette {
  const root = document.documentElement;
  const wasDark = root.classList.contains("dark");

  root.classList.remove("dark");
  const light = readPalette();
  root.classList.add("dark");
  const dark = readPalette();
  root.classList.toggle("dark", wasDark);

  return {
    pairs: TOKENS.map((token, index) => ({
      ...token,
      light: light.values[index] ?? "",
      dark: dark.values[index] ?? "",
    })),
    surface: { light: light.surface, dark: dark.surface },
  };
}

/**
 * A read value as the artboard captions it: a hex as it is, and a translucent
 * one as its alpha — `rgba(129, 140, 248, 0.12)` becomes `12%`.
 *
 * Not an abbreviation for its own sake. Several of the dark values are the
 * accent at an alpha, the caption is 10px mono in a fifth of a column, and the
 * full functional notation wraps onto a second line and pushes the row out of
 * the grid the artboard drew. The number is still computed from what was read,
 * so it cannot go on saying `15%` about a token that has since moved to `.12` —
 * which is exactly what the hand-written caption in the mockup does.
 */
function caption(value: string): string {
  const alpha = /^rgba?\([^)]*?,\s*(0?\.\d+)\s*\)$/.exec(value);
  if (alpha === null) return value === "" ? "\u2014" : value;
  return `${Math.round(Number(alpha[1]) * 100)}%`;
}

export type { TokenPair, TokenPalette };
export { caption, readTokenPairs, SURFACE, TOKENS };
