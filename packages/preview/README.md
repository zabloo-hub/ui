# @zabloo/preview

> The chrome of the `zabloo dev` web preview: topbar, stage, console, statusbar and the
> floating bindings panel.

**Private, and it stays private.** This package is never published. What ships is its
**build output**: `@zabloo/cli`'s build copies `dist/` into `packages/cli/dist/preview/` and
the CLI serves it as static files, so there is no new npm package and no React anywhere in
the published dependency tree. It is a `devDependency` of `@zabloo/cli` for one reason only
— that is what makes pnpm build this before the CLI.

The canvas inside the page is **not** this package: it belongs to
[`@zabloo/renderer-web`](../renderer-web), the self-renderer the engine SDKs also run. This
is the tool around it — and the chrome's light/dark theme deliberately never reaches inside
the canvas, which draws the developer's UI, not ours.

What the chrome does, from a user's side, is
[in the docs](../../docs/project-structure.md#the-preview).

## Developing it

```bash
pnpm --filter @zabloo/preview dev     # Vite on :5173
```

That dev server **proxies a real `zabloo dev`**: `/envelope`, `/asset/<hash>` and `/events`
go to `http://localhost:5078`. So the loop is two terminals — a project running `zabloo dev`
in one, this in the other — and the chrome hot-reloads against live envelopes and live saves
without rebuilding the CLI. With nothing on `:5078` the page comes up disconnected, which is
one of the states worth developing against anyway.

Workspace dependencies resolve to their **sources**, not to their `dist/`, exactly like
`tsconfig.base.json` and `vitest.shared.ts` do — a fresh clone can run this before anything
has been built.

```bash
pnpm --filter @zabloo/preview build       # → dist/, what the CLI copies
pnpm --filter @zabloo/preview test
pnpm --filter @zabloo/preview typecheck
```

### `/kit`

`http://localhost:5173/kit` is the UI kit: every chrome component in every state, side by
side, in both themes. It is how the design gets reviewed against the artboards without
driving the real preview into each state by hand — and how a token that only breaks in dark
gets caught.

Two pages, one bundle, and a `pathname` check in `main.tsx` rather than a router: there are
exactly two of them, and the server already falls back to `index.html`.

## Where things live

```
src/
├── styles/       tokens.css (the palette) + globals.css (the mapping to utilities)
├── store/        eleven zustand slices, one flat state, persisted under `zabloo.preview`
├── bridge/       the renderer's side: mount/reload, values, events, stats, assets
├── session/      the wire (SSE + fetch) and its translation into store actions
├── components/   ui/ (vendored shadcn) + topbar/ stage/ console/ statusbar/ bindings/ zen/
├── kit/          the /kit page and its fixtures
└── lib/utils.ts  `cn`
```

Four things about that tree are decisions, not layout:

- **`components/ui/**` is vendored code.** It is generated with shadcn's CLI and compacted to
  the design's measurements *by variant*, never by retouching call sites. The files keep
  shadcn's kebab-case even though the rest of the repo is PascalCase, and the CLI's raw
  output lands in its own commit before anything is changed — so a future `shadcn add` is a
  readable diff instead of a manual reconciliation.
- **No component writes a colour.** The design arrives high-fidelity with everything inline;
  the translation happens once, in `styles/`. See [`src/styles/README.md`](src/styles/README.md)
  for the full token tables — and for the rule that bites: **every named theme utility must
  be declared in `cn`'s `extendTailwindMerge`**, or tailwind-merge misfiles it and it
  vanishes with no error anywhere.
- **The fonts are bundled**, not pulled from a CDN: `zabloo dev` is a local tool that has to
  look the same with the network unplugged. `globals.css` declares the `@font-face`s by hand
  against `@fontsource-variable`'s files so only the subsets this chrome can render travel in
  the CLI's tarball.
- **The store is flat and slice-shaped.** `set({ theme })`, never `set({ theme: { theme } })`,
  which is what makes a selector cost the same as reading a field. `createPreviewStore()`
  exists beside the `useStore` singleton so the tests can run a store against a storage that
  throws on purpose — the contract there is that **nothing in `store/storage.ts` ever
  throws**, because a preview that failed to boot over a remembered dropdown would be trading
  the tool for a preference.

## Testing

Vitest + jsdom + Testing Library, one `*.test.tsx` beside each unit.

**The convention, and it is load-bearing:** a component's own suite owns its *behaviour* —
branches, states, aria, interaction. The suite of the region that contains it (`Topbar`,
`Console`, `Statusbar`, `BindingsPanel`…) asserts **composition only**: which controls exist
and in what order, never what they do inside. A behaviour assertion in the parent is phantom
coverage — it reads green over a hole — and with this rule the absence of a sibling test file
*is* the signal that something is uncovered.

`App.strict-mode.test.tsx` is the integration test, and it runs under `<StrictMode>` on
purpose: double-invoked effects are where a mount/dispose pair gets caught leaking a handle.

The `testTimeout` is raised in `vite.config.ts` and that is deliberate — a timeout is there
to catch a *hung* test, and a `userEvent` click in a suite this size is competing for CPU
with every other worker on the machine. When the suite grows and tests go amber, the global
goes up; never a per-test timeout.
