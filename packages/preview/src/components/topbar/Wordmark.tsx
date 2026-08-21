/**
 * `▦ zabloo dev`, and deliberately the smallest thing in the bar: what matters
 * in a dev tool is what sits under the chrome, not whose chrome it is. A 16px
 * square, a 13px name, and a `dev` at 10px that barely registers.
 *
 * The gradient comes from the `brand-gradient` utility over `--brand-gradient`,
 * the one place the design's two indigos are written down, so the square follows
 * the theme without this file knowing there are two of them.
 *
 * `dev` wears `text-muted-foreground`: the artboards draw it #a1a1aa in light
 * and #71717a in dark, which is exactly what that token is worth in each theme —
 * the same pair the viewport picker's resolution already reads off it.
 */
function Wordmark() {
  return (
    <div data-slot="wordmark" className="flex items-center gap-[7px] pr-1 pl-[2px]">
      <div className="size-4 shrink-0 rounded-[5px] brand-gradient" />
      <span className="text-brand font-semibold">zabloo</span>
      <span className="font-mono text-label text-muted-foreground">dev</span>
    </div>
  );
}

export { Wordmark };
