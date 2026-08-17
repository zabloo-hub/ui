# @zabloo/renderer-web

> The zabloo self-renderer for the browser: give it an
> [IR envelope](https://github.com/zabloo-hub/ui/blob/main/docs/README.md) and a
> `<canvas>`, and it draws the UI on WebGL2 — its own layout pass, its own tessellator,
> its own glyph atlas.

Part of [zabloo/ui](https://github.com/zabloo-hub/ui) — build your game's UI once in
React, ship a compact engine-agnostic IR, and let a lightweight SDK draw it inside Unity,
Godot or Unreal.

The browser is just another engine target here: nothing is mapped to DOM elements, so
what you see is what the in-engine SDKs paint. It powers the `zabloo dev` live preview
and is the seed of the visual editor's canvas.

## Install

```bash
npm install @zabloo/renderer-web
```

## Mounting a view

```ts
import { mount } from "@zabloo/renderer-web";

const canvas = document.querySelector("canvas") as HTMLCanvasElement;
const envelope = await fetch("/zabloo.ir.json").then((r) => r.text());

const ui = mount(canvas, envelope, {
  view: "main-menu", // default: the envelope's first view
  background: "#11141d",
  onAction: (action, context) => {
    if (action === "play") startGame();
    if (context) console.log("fired from item", context.path);
  },
  onDataChanged: (path, value) => console.log("player wrote", path, "=", value),
  onDiagnostic: (d) => showInEditor(d.level, d.code, d.path, d.message),
});

await ui.ready; // the view has swapped in its own text rasterizer and repainted

ui.setData("player.gold", 1250); // bound Text/visible/checked react and re-lay out
ui.reload(nextEnvelope); // hot-update, same path a shipped SDK uses
ui.dispose();
```

`mount` throws an `EnvelopeError` if the payload is unusable — there is no previous UI to
protect, and the caller has to hear that its payload never became a view. `reload` never
throws: a refused hot-update is discarded and the view on screen stays exactly as it is.

The handle also drives the UI the way a player would (`setOpen`, `setChecked`,
`setValue`, `setText`, `setSelectedTab`, `setScroll`), exposes the frame's measurements
via `snapshot()` — rects, wrap points, baselines, clips, layer order, focus/hover/press,
read a node at a time with `findNode(snapshot, "buy-btn")` — and its cost via `stats()`.

`viewIds` is read from the envelope currently loaded, so a hot-update that adds, drops or
renames views is reflected the next time you read it — a view picker should re-read it
after every `reload` rather than keep the array it got at mount.

## Authoring errors

`onDiagnostic` receives every [diagnostic](https://github.com/zabloo-hub/ui/blob/main/docs/format/loading.md)
the loading contract produces, for both `mount` and `reload`: a `warn` was repaired and
the envelope loaded without the broken part, a `fatal` means nothing loaded (and arrives
just before `mount` throws). Each one carries a stable `code` and the `path` into the
envelope it sits on, so an error overlay, a dev server or an editor can show it where the
author is looking:

```ts
mount(canvas, envelope, {
  onDiagnostic: ({ level, code, path, message }) => {
    if (level === "fatal") overlay.show(message); // nothing loaded: the view is stale
    else console.info(`[${code}] ${path}`, message); // repaired: the view is fine
  },
});
```

Without it, warnings go to the console as `[zabloo]` lines — which is exactly what the
CLI preview stopped relying on: a page cannot read its own console.

## Script tag

The `./global` subpath is an IIFE bundle that defines `window.ZablooRenderer`, for pages
with no bundler (this is how the CLI's preview serves the renderer):

```html
<script src="/node_modules/@zabloo/renderer-web/dist/index.global.js"></script>
<script>
  const ui = ZablooRenderer.mount(document.querySelector("canvas"), envelope);
</script>
```

Because it is loaded by path as often as by specifier, `exports["./global"]` is a plain
string with no conditions — keep it resolvable from both ESM and CJS.

## Documentation

- [Component catalog](https://github.com/zabloo-hub/ui/blob/main/docs/components/README.md) — every node type this renderer implements.
- [Loading](https://github.com/zabloo-hub/ui/blob/main/docs/format/loading.md) — what a refused payload does, and why.
- [Layout](https://github.com/zabloo-hub/ui/blob/main/docs/format/layout.md) · [Style](https://github.com/zabloo-hub/ui/blob/main/docs/format/style.md) · [Input & focus](https://github.com/zabloo-hub/ui/blob/main/docs/format/input.md) · [Motion](https://github.com/zabloo-hub/ui/blob/main/docs/format/motion.md)
- [Full documentation](https://github.com/zabloo-hub/ui/blob/main/docs/README.md)

## License

MIT
