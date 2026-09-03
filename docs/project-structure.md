# Project structure & CLI

A zabloo project is a small React project with one job: produce an
[envelope](format/envelope.md). There is no bundler and nothing ships to the device but
JSON — "build" means *run the author's components and serialize what they emit*.

```
my-game-ui/
├── src/
│   ├── views/        one .tsx per view — the filename is the view id
│   ├── components/   your React components (they never reach the IR)
│   ├── assets/       .png/.jpg the export inlines in the envelope
│   └── theme.ts      tokens, variants and motion defaults
├── zabloo.config.ts
└── package.json
```

Only `src/views/` is required. `src/components/` is a convention (any layout works —
components are ordinary imports), and `src/assets/`, `src/theme.ts` and `zabloo.config.ts`
are each optional.

Scaffold one with `npx create-zabloo-app my-game-ui`, which writes exactly the tree above
plus the `dev` / `dev:godot` / `dev:unity` / `build` scripts.

## `src/views/` — one file, one view

Every `.tsx` (or `.ts`) directly in `src/views/` becomes one view of the envelope.

| Rule | Detail |
|---|---|
| **The filename is the view id** | `src/views/main-menu.tsx` → `"main-menu"`, the id the SDK loads by. |
| **A default export, and it must be a component** | Anything else fails the export: `main-menu.tsx: a view must default-export a component`. |
| **`export const id` pins the id** | `export const id = "main-menu"` keeps the id stable across a rename. A non-string is ignored and the filename wins. |
| **Ids are unique** | Two files resolving to the same id fail the export rather than silently dropping one. |
| **One root primitive** | The component must resolve to exactly one primitive — wrap siblings in a `<Container>`. |
| **Subdirectories are not scanned** | The scan is flat: `src/views/hud/bar.tsx` is not a view. |

Files are read in sorted order, so the envelope's view keys come out sorted by filename.

Every view is rendered inside a [`ThemeProvider`](react-api.md#themeprovider) built from
`src/theme.ts`, which is what resolves `variant` and the motion defaults at export time.

## `src/assets/` — images

`<Image src="icons/coin.png">` is a path **relative to `src/assets/`** (the Flutter
convention). The export reads the file, hashes it, inlines it in the envelope's asset
manifest and rewrites the prop to its `asset:<id>` ref — so the path is authoring input,
never a runtime lookup, and it cannot be a data binding.

| Situation | What happens |
|---|---|
| Accepted types | `.png`, `.jpg`, `.jpeg`. Any other extension **fails** the export. |
| Missing file | **Fails**, naming the view, the node and the path it looked at. |
| Corrupt or mislabeled | Content that does not match the extension **fails** — a `.png` that is not a PNG, a truncated file. |
| A path outside `src/assets/` | **Fails**: absolute paths and `../` escapes are refused. |
| A binding on `src` | **Fails**: an asset path is authoring input, not runtime data. |
| Over **2 MB** in one asset | Warning — "consider compressing/rescaling". |
| Over **15 MB** in total | Warning — "hot-updates will be heavy". |
| Over **50 MB** in total | **Fails**: that is the hot-update ceiling. |

Identical paths are read once: the manifest is keyed by the path, so an icon used in ten
views is inlined once.

Assets are inlined base64 in the envelope, which is what makes one file the whole delivery.

## `src/theme.ts`

Three optional named exports — `tokens`, `variants`, `transitions` — read by name. The file
itself is optional too: a project without it exports with no tokens.

→ [Theming](theming.md) for the contract and how each one resolves.

## `zabloo.config.ts`

A **default export**, and today it has exactly one option:

```ts
// zabloo.config.ts
export default {
  outDir: "dist", // the only option in v1
};
```

| Option | Type | Default | Description |
|---|---|---|---|
| `outDir` | `string` | `"dist"` | Directory the envelope is written to, relative to the project root. |

The filename inside it is fixed: `zabloo.ir.json`. Views come from `src/views/`, assets from
`src/assets/` and the theme from `src/theme.ts` — none of them are configurable, on purpose:
the layout is the contract the tooling and the scaffolder share.

Without the file, `outDir` is `dist`.

## The CLI

`@zabloo/cli` installs the `zabloo` binary, with `zb` as a shorthand. It is a command-line
tool and nothing else — it exposes no importable API. Build against
[`@zabloo/format`](format/envelope.md) (the IR types and reader) or
[`@zabloo/react`](react-api.md) (`renderToIR`) instead.

### `zabloo export`

Runs the project's components and writes one versioned envelope.

```bash
zabloo export              # → dist/zabloo.ir.json
zabloo export --cwd ../ui  # project root (default: ".")
zabloo export --porcelain  # print only the output path, for scripts
```

| Flag | Default | What it does |
|---|---|---|
| `--cwd <dir>` | `"."` | Project root. |
| `--porcelain` | off | Prints only the output file path. Warnings still go to stderr. |

What it does, in order: loads `zabloo.config.ts` and `src/theme.ts` if they exist, imports
`react` and `@zabloo/react` **from the project** (so your components and the reconciler
share one React instance), renders every view inside the theme, collects and inlines the
assets, **validates the envelope**, and writes it.

The validation runs *before* the write and it is the last cheap place to catch an authoring
mistake. What gets written is the tree your components produced — never the repaired one:
silently dropping a node from the artifact would hide the bug the warning just named. A
`fatal` diagnostic fails the export; `warn`s are printed as `⚠` lines and the file is
written.

```
zabloo export: wrote 2 view(s) [main-menu, settings]
  assets: 1 (0.1 MB total)
    icons/coin.png (96 KB)
  → /abs/path/dist/zabloo.ir.json
```

A failed export prints one line — `zabloo export: <message>` — and exits `1`.

### `zabloo dev`

Re-exports on every save and serves a live web preview rendered by
[`@zabloo/renderer-web`](format/host-channel.md), the same self-render pipeline the engine
SDKs run — so the preview needs no engine installed. Around that canvas is a tool with
parts that have names, and the rest of these docs use them: see
[the preview](#the-preview) below.

```bash
zabloo dev                     # → http://localhost:5078
zabloo dev --open              # …and open it in the browser
zabloo dev --godot             # …and hot-swap each save in the running Godot game
zabloo dev --preview-port 8080 # port of the web preview
zabloo dev --godot-port 5079   # dev-mode port of the Godot game (with --godot)
```

| Flag | Default | What it does |
|---|---|---|
| `--cwd <dir>` | `"."` | Project root. |
| `--godot` | off | Also pushes each export to the running Godot game's dev mode. |
| `--godot-port <port>` | `5079` | The Godot game's dev-mode port (only with `--godot`). |
| `--unity` | off | Also POSTs each export to the Unity SDK's dev mode (the receiver comes with the rebuilt SDK, F12). |
| `--port <port>` | `5077` | The Unity dev-mode port (only with `--unity`). |
| `--preview-port <port>` | `5078` | The web preview's port. |
| `--open` | off | Opens the preview in the browser once it is up. |
| `--allow-host <host>` | — | An extra `Host` the preview answers to, beyond the loopback names. Repeatable; `"*"` turns the check off. |

It watches `src/` recursively plus `zabloo.config.ts`, debounces 150 ms, and never runs two
exports at once (a save during an export queues exactly one more).

**If the preview port is taken it walks forward** up to 10 ports and says which one it got;
the URL it prints is always the server it actually bound. If all 10 are taken it refuses to
start rather than print a URL serving another project's preview.

One flag per engine, combinable — the React Native model. Either way the save reaches the
engine through the same loading path a manual import and a production hot-update take, and
the data the game pushed survives the swap: it is cached on the document, not on the view.
If nothing is listening the export still succeeds, and the CLI says so **once**, holding the
line until the receiver answers again.

**With `--godot`**, the receiver is the addon's `ZablooDevMode` autoload, which enabling the
Zabloo plugin installs — a game wires nothing. It listens on loopback in **debug builds
only**, and reloads every `ZablooView` in the running scene. What travels is the envelope
**without its asset bytes**, plus the address of the preview's `/asset/<hash>` route: the
game fetches only the content hashes it does not already hold, so a project with megabytes
of PNGs still moves a few KB per save, and an image is transferred once no matter how many
reloads follow. The rehydrated envelope is what reaches the loader — always a complete one.
A second instance of the game finds the port taken and says so; `zabloo/dev_mode/port` in
the project settings moves it.

**With `--unity`**, the push goes to the Unity SDK's dev mode. That SDK is being rebuilt as
a thin adapter over the same core Godot runs (F12) and has no receiver yet, so today the flag
only reports that nothing is listening. The push carries the whole envelope.

### The preview

Four regions and one floating panel. The canvas is the only part of the page the renderer
draws; everything else is chrome, and the chrome's own light/dark theme never reaches
inside the canvas.

| Region | What is in it |
|---|---|
| **Topbar** | The **view selector** (one entry per view in the envelope; a view whose load produced a fatal wears a red dot), the **viewport picker**, the **DPR** control, the `{ } Bindings` toggle, and — pushed to the right — the **connection pill**, the theme toggle and zen mode. |
| **Stage** | The canvas, under a caption that reads `preset · resolution · @DPR · zoom`: `Steam Deck · 1280×800 · @1× · 60%`. |
| **Console** | Three tabs — **Actions**, **Problems**, **Stats** — plus `Clear` and a collapse chevron. |
| **Statusbar** | The connection state, the problem counts, the envelope's filename, `60 fps · 1.9 ms` (or `idle`), and a gamepad indicator. |
| **Bindings panel** | A card floating over the stage with one typed field per bound path. Drag it by its grip to move it out of the way of what it is inspecting; `×` closes it and the topbar's `{ } Bindings` brings it back. |

**The viewport is a statement about layout, not about the window.** A fixed preset — Fit
window, 1080p, 4K TV, Ultrawide, Steam Deck, Switch, phone portrait/landscape, or a custom
`W×H` — keeps the canvas at its declared pixel size, which is what the renderer measures
against, and only a CSS transform shrinks it to what fits on screen. So a UI authored for
1080p can be read at 720p without touching the browser. The scale never goes **above 1**:
blowing a 720p view up to fill a 4K monitor would be showing you resampling instead of your
UI. Next to it, the DPR control renders at a forced device pixel ratio — it remounts,
because the glyph atlases are rasterized at that scale.

**The bindings panel is you playing the game.** It auto-discovers every path the envelope
binds and gives each one an editor picked by **where the path is bound**, not by what the
value happens to be: `checked`/`visible`/`disabled`/`open` are a switch, `items` is a JSON
editor, a `Slider`'s `value` is a number stepper and a `TextInput`'s is a text field. A prop
the panel does not know falls to a string field, which is the editor that can express
anything. When the UI writes back through a read/write binding, that field highlights and
shows a `← UI` chip — the round trip in [Bindings & actions](format/bindings.md), visible.

**The console is where the preview answers questions.** *Actions* is the running log —
`view` lines when a view loads, `write` lines when the UI writes a bound path, and `action`
lines carrying the [action context](format/bindings.md#action-context) of the item a press
came from. *Problems* is the [loading contract](format/loading.md)'s diagnostics, fatals
first, each as `[code] path — reason`, with a jump to the view it sits on. *Stats* is what
the last painted frame cost.

**Zen mode** (the corners icon, or `Esc` to leave) collapses the topbar, the console, the
statusbar and the panel, leaving the canvas full-bleed under one floating pill. The panel's
open state and position, the console's open state and tab, the theme, the viewport and the
view you were last on are all remembered in `localStorage`; **zen is not** — coming back to
a window with no controls in it is worse than re-entering zen.

Inside the canvas, the keyboard is the renderer's: arrows move focus spatially, Enter and
Space press, and a gamepad lights the statusbar's indicator when you plug one in.

### When an export fails

**Never a red overlay.** A save whose export is refused leaves the **last good render** on
screen and says so around it: a veil over the canvas with a `Stale — export failed, showing
last good render` pill on top, the connection pill switching to amber **Stale** (hover it
for the export's message), the statusbar counting `1 fatal`, and the bindings panel's fields
going inert under a note that the values are held. The reason itself is one click away in
the **Problems** tab. Hiding a working render behind an error box would take away the very
thing you were looking at; a stale render never passes for a fresh one, but it also never
disappears.

The connection pill's three states are worth telling apart: **Live** is the stream up and
the last export loaded, **Stale** is the server reachable but the view on screen older than
the file on disk, and **Disconnected** is the stream gone — the server stopped, or the
network went away.

## Related

- [Getting started](getting-started.md) — the same project, built one step at a time.
- [`@zabloo/react` reference](react-api.md) — what the views are written with.
- [Theming](theming.md) — the `src/theme.ts` contract.
- [The envelope](format/envelope.md) — what `zabloo export` writes.
- [Troubleshooting](troubleshooting.md) — when the export refuses.
