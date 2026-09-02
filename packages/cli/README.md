# @zabloo/cli

> `zabloo` — the authoring tooling for [zabloo/ui](https://github.com/zabloo-hub/ui):
> turn a React project into a versioned IR envelope, and watch it live while you write
> it.

Build your game's UI once in React, ship a compact engine-agnostic IR, and let a
lightweight SDK draw it inside Unity, Godot or Unreal.

## Install

Most projects get this wired up by the scaffolder and never install it by hand:

```bash
npm create zabloo-app my-game-ui
```

To add it to an existing project:

```bash
npm install -D @zabloo/cli @zabloo/react
```

The binary is `zabloo`, with `zb` as a shorthand.

## Commands

### `zabloo export`

Every `.tsx` in `src/views/` is one view of the envelope, and the filename is the view ID
the SDK loads by. The export runs your components (they execute at authoring time and
emit primitives), inlines the images they reference from `src/assets/`, and writes one
versioned envelope:

```bash
zabloo export                        # → dist/zabloo.ir.json
zabloo export --cwd ../ui            # project root (default: ".")
zabloo export --out build/en.json    # this file instead of <outDir>/zabloo.ir.json
zabloo export --porcelain            # print only the output path, for scripts
```

`--out` is relative to the project root and creates the directories on the way, so one
project can emit several artifacts — per locale, per platform — from a CI matrix with no
config file per row.

### `zabloo dev`

Re-exports on every save and serves a live web preview that renders the envelope with
[`@zabloo/renderer-web`](https://github.com/zabloo-hub/ui/tree/main/packages/renderer-web)
— the same self-render pipeline the engine SDKs run, so the preview needs no engine
installed. Around that canvas is a tool: a topbar (view selector, viewport presets, DPR,
connection pill, theme, zen mode), an IDE-style console (**Actions**, **Problems**,
**Stats**), a statusbar, and a floating panel with one typed field per bound path — which
is you playing the part of the game.

```bash
zabloo dev                     # → http://localhost:5078
zabloo dev --open              # …and open it in the browser
zabloo dev --godot             # …and hot-swap each save in the running Godot game
zabloo dev --preview-port 8080 # port of the web preview
zabloo dev --godot-port 5079   # dev-mode port of the Godot game (with --godot)
zabloo dev --unity             # …and push each save to the Unity editor's dev mode
zabloo dev --allow-host <host> # answer to another Host too (repeatable)
```

One flag per engine, combinable. With `--godot`, every save hot-swaps the running game
through the same loading path production hot-updates use — the receiver is the addon's
`ZablooDevMode` autoload, installed by enabling the Zabloo plugin, listening on loopback in
debug builds only. The push carries the tree **without its asset bytes**; the game fetches
only the content hashes it does not already hold, so a save moves KB and an image is
transferred once. `--unity` does the same for the Unity editor, whole envelope and all.

**A save whose export fails is reported on the page, and never as a red overlay.** The
**last good render stays on screen** — that is the thing you were looking at, and hiding it
behind an error box would take away the comparison you need. Instead the canvas goes under a
veil with a `Stale — export failed, showing last good render` pill on it, the connection
pill turns amber **Stale** and carries the export's message in its tooltip, the statusbar
counts the fatals and warnings, and the reason itself is one click away in the **Problems**
tab. The bindings panel's fields go inert while the render is stale — pushing a value into a
view that is not the one you are editing would be a lie — and the values are held, not lost.

Red is reserved for **Disconnected**: the event stream is gone and nothing is watching your
saves. Amber means your export broke; red means the server did.

If the preview port is taken, `dev` moves to the next free one and says so — the URL it
prints is always the server it actually bound.

**Viewport presets.** The topbar picks the size the UI is laid out at — Fit window, 1080p,
4K TV, Ultrawide, Steam Deck, Switch, phone portrait/landscape, or a custom `W×H` —
independently of how big the browser is. Under a fixed preset the canvas keeps its declared
pixel size, which is what the renderer measures against, and only a CSS transform shrinks it
to what fits on screen; so a UI authored for 1080p can be checked at 720p without touching
the window. The scale never goes above 1, and the caption over the canvas says what you are
looking at: `Steam Deck · 1280×800 · @1× · 60%`. The DPR selector next to it re-renders at a
forced device pixel ratio (it remounts, because the glyph atlases are rasterized at that
scale). Both are remembered across reloads.

**Stats.** The console's **Stats** tab shows what the last painted frame cost — frames per
second, milliseconds, draw calls, vertices, glyph atlases and their bytes, nodes resolved,
and whether the frame was a repaint only. It reads frames as the renderer reports them,
not on a timer of its own: the renderer paints on demand, so a still scene painting
nothing shows as `idle` rather than as a stall.

**Hosts.** The preview answers to `localhost` and the other loopback names only, and
replies `403` to anything else. This is not paranoia about the network: a page on an
attacker's domain whose DNS answers `127.0.0.1` reaches a loopback-bound server through
your own browser and can read the envelope you are working on. Behind a proxy, a Codespace
or a named tunnel, allow the hostname explicitly with `--allow-host <host>` (repeatable,
and `--allow-host "*"` turns the check off).

**Where the page comes from.** The chrome is
[`@zabloo/preview`](https://github.com/zabloo-hub/ui/tree/main/packages/preview), a private
package that is never published; what ships is its build output, copied into this package's
`dist/preview/` and served as static files. So there is no new npm package and no React in
this CLI's dependency tree — but the tarball does carry the built chrome, which is most of
its weight.

### `zabloo preview <envelope.json>`

The same preview, for an envelope that has no project around it — a build artifact, a file
a colleague attached to a ticket:

```bash
zabloo preview dist/zabloo.ir.json
zabloo preview ui.json --open --preview-port 8080
```

Nothing exports: the file on disk is the source, and saving over it (or re-downloading it)
reloads the browser the way a save does under `dev`. An envelope the loading contract
refuses is reported before the server comes up, rather than as an empty canvas.

### `zabloo validate [file]`

Checks an envelope against the [loading contract](https://github.com/zabloo-hub/ui/blob/main/docs/format/loading.md)
every SDK shares, and answers in exit-code terms:

```bash
zabloo validate                     # the project's own dist/zabloo.ir.json
zabloo validate build/ui.json       # any envelope, relative to --cwd
zabloo validate --json              # the report as a value
zabloo validate --strict            # warnings fail too, not only fatals
```

| Exit | Meaning |
|---|---|
| `0` | An SDK would load it. Warnings may have been reported: those were **repaired**, so the envelope loads without the broken parts. |
| `1` | A `fatal` — nothing would load it — or, under `--strict`, any diagnostic at all. |

With no argument it validates what `zabloo export` last wrote, following `outDir` from
`zabloo.config.ts`. Every diagnostic is printed with its stable `code` and its path into
the envelope (`views["hud"].children[2].text`); `--json` gives the same report as
`{ file, ok, views, diagnostics }` for a step that wants to annotate a diff.

#### Validating in CI

The envelope is what ships to live games and can be hot-updated into them, so it is worth
refusing a broken one at the pull request rather than at the player:

```yaml
name: UI
on: [push, pull_request]

jobs:
  envelope:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci

      # Re-export from source: this is what catches an envelope committed from an
      # older tree, which validating the committed file alone never would.
      - run: npx zabloo export

      # `--strict` because a warning means a node the author wrote is NOT in the
      # artifact. It loads; it just does not have that part.
      - run: npx zabloo validate --strict
```

If the envelope is committed rather than built in CI, drop the `export` step and point
`validate` at the file: `npx zabloo validate ui/zabloo.ir.json --strict`.

## Configuration

`zabloo.config.ts` at the project root — currently `outDir` (default `dist`). Both it and
`src/theme.ts` are optional: without them a project exports to `dist` with no tokens.
Views come from `src/views/`, assets from `src/assets/`, tokens and variants from
`src/theme.ts`.

## Not a library

This package is a command-line tool: it exposes no importable API, and its `exports` are
closed deliberately. Build against
[`@zabloo/format`](https://github.com/zabloo-hub/ui/tree/main/packages/format) (the IR
types and reader) or
[`@zabloo/react`](https://github.com/zabloo-hub/ui/tree/main/packages/react) (`renderToIR`)
instead.

## Documentation

- [The envelope](https://github.com/zabloo-hub/ui/blob/main/docs/format/envelope.md) — what `zabloo export` writes.
- [Component catalog](https://github.com/zabloo-hub/ui/blob/main/docs/components/README.md)
- [Full documentation](https://github.com/zabloo-hub/ui/blob/main/docs/README.md)

## License

MIT
