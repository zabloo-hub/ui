# hello-button

**The smallest whole project.** One view, one bound value, one action — the vertical
slice that goes all the way from React to pixels in Unity. Start here to *read* one; the
[`showcase`](../showcase) next door is where you look things up.

```bash
pnpm --filter hello-button-example dev     # http://localhost:5078
pnpm --filter hello-button-example build   # dist/zabloo.ir.json — the IR itself
```

## What it demonstrates

- **A pressable `<Button>`** wired to a named action (`buy`, `quit`). The game hears a
  string; it never hears about a click.
- **A bound `<Text>`** — `player.gold` comes from the game, not from the document.
- **`<Collapse>` and `<Accordion>`**: a Collapse relayouts at runtime when it opens, and
  the Accordion is a *flattened composite* — it reaches the IR as a `Container` with the
  `exclusive-open` group, not as a node type of its own.
- **Motion without keyframes**: a `transition` tweens whatever value changes. The
  `<ProgressBar>` interpolates its **value** and lays the fill out from it (the rect is
  never the thing interpolated), and the `<Spinner>` loops on `motion.loop`.
- **Theming**: every duration, colour and radius in `src/theme.ts` is a token, so a
  "reduce motion" theme setting `motion.*` to 0 stops the UI dead without re-emitting a
  single node. `variant="primary"` is resolved at export time and never reaches the IR.
- **Opacity inherits multiplicatively** — the dimmed footer row is one `opacity` on the
  parent.

## Driving it

The preview plays the part of the game: the bindings panel fills from the envelope's
bindings, actions land in the console's **Actions** tab as they fire, and the live handle is
`window.zabloo`. Paste into the browser console:

```js
zabloo.setData("player.gold", 900)
zabloo.setData("player.hp", 0.35)   // and again with 0.9 — the bar retargets mid-glide
zabloo.setData("inbox.unread", 12)  // the Badge on the "Social" header
zabloo.setData("shop.thanked", true)
```

Press `buy` or `quit` and the action shows up in the log — that string is what a game's
C# receives.

## Layout

```
src/
├── views/main-menu.tsx   one file, one view (the filename is the view ID)
└── theme.ts              tokens, per-component transitions, variants
zabloo.config.ts          project config (outDir)
```

## Related

- [Getting started](../../docs/getting-started.md) — build a screen like this from an empty folder.
- [Component catalog](../../docs/components/README.md) — one page per node type.
- [`examples/README.md`](../README.md) — which example to open for what.
