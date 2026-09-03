# zabloo/ui documentation

This is the reference for the **zabloo IR** — the versioned, engine-agnostic format a
zabloo UI is shipped as — and for the **component catalog** built on top of it.

```
authoring (React/JSX + tokens) → IR envelope (JSON) → engine SDK
                                          → tessellates to GPU geometry → pixels
```

The IR is a **payload consumed at runtime**, not build-time source. It is delivered to
live games and can be hot-updated, so an SDK older than the content it receives is a
normal situation the format is designed for — see [Versioning](format/versioning.md) and
[Loading](format/loading.md).

## Start here

New to zabloo? Everything below is normative reference — precise, and the wrong place to
begin. Build a screen first:

→ **[Getting started](getting-started.md)** — scaffold a project, author a shop screen, bind
it to game data, wire a button to C#, and load the envelope in Unity.

Already have a project? [Project structure & CLI](project-structure.md) is the same ground
as reference.

## The format

| Page | What it covers |
|---|---|
| [Envelope](format/envelope.md) | The unit an SDK loads: version, token dictionary, views, asset manifest. |
| [Layout](format/layout.md) | The Flexbox subset every target implements, and how nodes are measured. |
| [Style](format/style.md) | The style set, implicit paint, tokens, runtime states and their merge order. |
| [Input & focus](format/input.md) | Hit-testing, focusability, directional navigation, the focus trap. |
| [Bindings & actions](format/bindings.md) | The two dynamic mechanisms: named actions and data-path bindings. |
| [Motion](format/motion.md) | Per-node transitions, what animates and what snaps, the easing curves. |
| [Loading](format/loading.md) | Validation policy, diagnostics, and how unknown content degrades. |
| [Versioning](format/versioning.md) | What is additive, what breaks, and what an older SDK does about it. |
| [The host channel](format/host-channel.md) | How the game drives the UI: the operations in, the callbacks back. |

## The catalog

One page per node type. Each page documents the node as it appears in the IR **and** the
`@zabloo/react` components that emit it.

→ [Component catalog](components/README.md)

## Authoring

How a project is written, exported and themed. Not normative — this is the `@zabloo/react`
layer, which resolves away before the IR exists — but it is the whole contract between an
author and the tooling.

| Page | What it covers |
|---|---|
| [Project structure & CLI](project-structure.md) | Where views, theme and assets live, and the two commands that turn them into an envelope. |
| [`@zabloo/react` reference](react-api.md) | `renderToIR`, `ThemeProvider`, the shared prop types and the item-template types. |
| [Theming](theming.md) | Tokens, variants and motion defaults: one file, three resolution times. |
| [Troubleshooting](troubleshooting.md) | The sharp edges, every authoring error, and what to check when nothing happens. |

## For maintainers

→ [Releasing](releasing.md) — how a version reaches npm, and the gate that keeps it from
happening by accident.

→ [Performance](performance.md) — what a frame costs on each target, the budgets CI holds
it to, and how to measure it yourself.

## How to read these pages

**Types.** The IR is JSON. The types used throughout:

| Type | Meaning |
|---|---|
| `Dim` | A number of pixels, or a token reference — `12`, `"{space.3}"`. |
| `ColorValue` | A color literal, or a token reference — `"#4f46e5"`, `"{color.primary}"`. |
| `TokenRef` | `"{name}"` — looked up in the envelope's flat token dictionary. |
| `AssetRef` | `"asset:<id>"` — an entry in the envelope's asset manifest. |
| `Bindable<T>` | A literal `T`, or `{ "bind": "path.into.data" }`. |

**Defaults.** Every prop table gives the value an SDK uses when the prop is absent. A
prop with no default is required.

**Normative.** Sections marked *normative* describe behavior every SDK must reproduce
exactly — the same input has to produce the same result on every target. Where an
algorithm has a reference implementation in TypeScript, the page names it; those live in
`@zabloo/format` and are ported, not reinvented, by each SDK.

**Authoring.** The `@zabloo/react` layer is not part of the format. Composites and
variants are resolved at authoring time and never reach the IR: what the SDK receives is
always a tree of the node types documented here. Its own surface is under
[Authoring](#authoring).

## Internal context

[`internal/`](internal/README.md) holds the project's own working context — what the
product is, the IR design notes, the architecture decision log, the roadmap, and the
design/plan trail of past work. It lives in the repo so this one is self-contained; it is
**not** user documentation, and nothing there is normative.
