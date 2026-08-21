import * as React from "react";
import { KitCell } from "@/kit/KitCell";
import { caption, readTokenPairs, type TokenPair, type TokenPalette } from "@/kit/tokens";

/** Nothing read yet — the first render, and every render under jsdom. */
const EMPTY: TokenPalette = { pairs: [], surface: { light: "", dark: "" } };

/**
 * The eleven token pairs, each swatch split light | dark, plus the two faces.
 *
 * The values are READ (see `tokens.ts`), which is what makes this row worth
 * having: it says what the palette resolves to on this page right now, so a
 * token that was renamed, dropped or given a new value shows up here as a blank
 * or as the new colour instead of as a caption that used to be true.
 *
 * Each half is painted over the BACKGROUND of the theme it belongs to, and that
 * is not decoration. Half the dark palette is the accent at a low alpha —
 * `--indigo-soft` is `rgba(129,140,248,.12)` — and a translucent colour drawn
 * straight onto this white card is not the colour anyone will ever see; it is
 * the colour it would be in a light theme it does not belong to. The artboard
 * cheats the same thing by painting a flat `#312e5e`, which is what that alpha
 * resolves to over `#09090b`.
 *
 * `useLayoutEffect` and not `useEffect`: the read toggles `.dark` on `<html>`
 * twice, and doing that after the browser has been allowed to paint is how you
 * get a flash of the other theme on load. It runs once — the values do not
 * depend on which theme the kit is currently showing, since both halves are read
 * every time.
 */
function TokensCell() {
  const [palette, setPalette] = React.useState<TokenPalette>(EMPTY);

  React.useLayoutEffect(() => {
    setPalette(readTokenPairs());
  }, []);

  return (
    <KitCell id="tokens" label="Tokens · light / dark" className="col-span-2">
      <div className="grid grid-cols-5 gap-[10px]">
        {palette.pairs.map((pair) => (
          <Swatch key={pair.name} pair={pair} surface={palette.surface} />
        ))}
        <Specimen />
      </div>
    </KitCell>
  );
}

function Swatch({ pair, surface }: { pair: TokenPair; surface: TokenPalette["surface"] }) {
  return (
    <div data-token={pair.name} className="flex flex-col gap-[5px]">
      <div className="flex h-[34px] overflow-hidden rounded-md border border-border">
        <Half color={pair.light} over={surface.light} />
        <Half color={pair.dark} over={surface.dark} />
      </div>
      <span className="font-mono text-label text-muted-foreground">
        {pair.name} · {caption(pair.light)} / {caption(pair.dark)}
      </span>
    </div>
  );
}

/** The colour as a one-stop gradient, so it can lie ON the surface behind it. */
function Half({ color, over }: { color: string; over: string }) {
  return (
    <span
      className="flex-1"
      style={{
        backgroundColor: over,
        backgroundImage: color === "" ? undefined : `linear-gradient(${color}, ${color})`,
      }}
    />
  );
}

/**
 * The twelfth cell of the row, which is not a colour: the two faces at the size
 * the chrome reads them at. It is here rather than in a cell of its own because
 * the artboard treats a typeface as one more thing the theme hands you.
 */
function Specimen() {
  return (
    <div data-token="fonts" className="flex flex-col gap-[5px]">
      <div className="flex h-[34px] items-center overflow-hidden rounded-md border border-border">
        <span className="flex-1 text-center text-brand font-medium">Ag</span>
        <span className="flex-1 text-center font-mono text-brand font-medium">Ag</span>
      </div>
      <span className="font-mono text-label text-muted-foreground">Geist / Geist Mono</span>
    </div>
  );
}

export { TokensCell };
