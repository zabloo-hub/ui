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
plus the `dev` / `dev:unity` / `build` scripts.

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
SDKs run — so the preview needs no engine installed. It has a view picker, a data panel for
bound paths, an action log and arrow-key/Enter navigation.

```bash
zabloo dev                     # → http://localhost:5078
zabloo dev --unity             # …and push each save to the Unity editor's dev mode
zabloo dev --preview-port 8080 # port of the web preview
zabloo dev --port 5077         # dev-mode port of the Unity editor (with --unity)
```

| Flag | Default | What it does |
|---|---|---|
| `--cwd <dir>` | `"."` | Project root. |
| `--unity` | off | Also POSTs each export to the Unity editor's dev mode. |
| `--port <port>` | `5077` | The Unity editor's dev-mode port (only with `--unity`). |
| `--preview-port <port>` | `5078` | The web preview's port. |

It watches `src/` recursively plus `zabloo.config.ts`, debounces 150 ms, and never runs two
exports at once (a save during an export queues exactly one more).

**A failed export is reported on the page.** The error appears over the view that is still
on screen and the status dot turns red, so a stale render never passes for a fresh one.

**If the preview port is taken it walks forward** up to 10 ports and says which one it got;
the URL it prints is always the server it actually bound. If all 10 are taken it refuses to
start rather than print a URL serving another project's preview.

With `--unity`, every save hot-swaps the running view in the editor (Play mode included)
through the same loading path production hot-updates use. If the editor is not listening,
the export still succeeds and the CLI says the dev mode is unreachable.

## Related

- [Getting started](getting-started.md) — the same project, built one step at a time.
- [`@zabloo/react` reference](react-api.md) — what the views are written with.
- [Theming](theming.md) — the `src/theme.ts` contract.
- [The envelope](format/envelope.md) — what `zabloo export` writes.
- [Troubleshooting](troubleshooting.md) — when the export refuses.
