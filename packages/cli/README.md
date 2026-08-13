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
zabloo export              # → dist/zabloo.ir.json
zabloo export --cwd ../ui  # project root (default: ".")
zabloo export --porcelain  # print only the output path, for scripts
```

### `zabloo dev`

Re-exports on every save and serves a live web preview that renders the envelope with
[`@zabloo/renderer-web`](https://github.com/zabloo-hub/ui/tree/main/packages/renderer-web)
— the same self-render pipeline the engine SDKs run, so the preview needs no engine
installed. It has a view picker, a data panel for bound paths, an action log and
arrow-key/Enter navigation.

```bash
zabloo dev                     # → http://localhost:5078
zabloo dev --unity             # …and push each save to the Unity editor's dev mode
zabloo dev --preview-port 8080 # port of the web preview
zabloo dev --port 5077         # dev-mode port of the Unity editor (with --unity)
```

With `--unity`, every save hot-swaps the running view in the editor (Play mode included)
through the same loading path production hot-updates use.

## Configuration

`zabloo.config.ts` at the project root — currently `outDir` (default `dist`). Views come
from `src/views/`, assets from `src/assets/`, tokens and variants from `src/theme.ts`.

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
