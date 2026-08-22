# @zabloo/format

## 0.2.0

### Minor Changes

- 85a1a3a: Implement `disabled`, the last of the seven `StateName`s with no implementation behind it.
  It is a bindable prop on `NodeBase` rather than a derived state, because it **inherits**: a
  node's effective value is its own OR any ancestor's, so disabling half a form is one prop on
  the section. An `Overlay` restarts the chain — a modal declared inside a dimmed panel stays
  operable.

  A disabled node leaves the interaction model entirely: not focusable, no pointer, no
  directional navigation. A press falls **through** it, anything it was holding is released, and
  an in-flight Slider gesture is cancelled without committing. A disabled section stays readable
  and its ScrollView still scrolls, and the host data channel is never blocked.

- 85a1a3a: `onChange` on `ContainerNode`, meaningful under `group: "exclusive-check"`: the group owns the
  value, so the group is what answers "the selection moved". `<Select onChange>` was typed and
  documented but never reached the IR, and the renderer only ever fired from the option node —
  there was no typed way to get a named action out of a `<Select>`.

  It carries no payload beyond the name and ZAB-29's `ActionContext` (the chosen option's); the
  value already comes back through the data channel. It fires on the write edge, right after the
  new value lands in the bound path, and never when re-picking the option already selected.

### Patch Changes

- 85a1a3a: Give every package a README and complete npm metadata (`repository` with its monorepo
  `directory`, `homepage`, `bugs`, `keywords`, `engines.node`, explicit
  `publishConfig.access`), and ship `LICENSE` inside each tarball instead of only at the
  repo root. `@zabloo/cli` and `create-zabloo-app` close their `exports` to
  `./package.json`: they are executables, not libraries.

  Fix the import that made `@zabloo/react` unimportable from Node — `react-reconciler/constants`
  has no extension and that package declares no `exports`, so the ESM resolver refused it
  (`ERR_MODULE_NOT_FOUND`) for every real consumer.

- 85a1a3a: Accept the empty string as `Text` content. `@zabloo/react` emits `text: ""` routinely — a
  `<Select>` label whose value is not a binding, a `<Badge>` with no count, `<Text></Text>` — and
  `readEnvelope` was dropping those nodes with `invalid-node`. What sinks a node is the field
  being **absent**, not empty; they are different things and now they say so.

  An empty `Text` measures one line (0 × lineHeight), which becomes normative: a `<Row gap={8}>`
  keeps its slot and both gaps when a binding empties, instead of collapsing and shifting its
  siblings. Purely additive — the set of envelopes that load only grows.

- 85a1a3a: Six surgical correctness fixes; none of them moves a rect in the golden corpus.

  - `arrange` returned before the `isScrollView` block when nothing was left in flow, so a
    ScrollView whose children all turned `visible: false` kept the last populated frame's
    `scrollMax` and went on scrolling into nothing.
  - `crossOf` read the raw `layout.height` instead of the resolved one — the single place in the
    pass that did — so an unresolvable token took the "declared" branch and gave the slot its
    content's height instead of the whole rail.
  - `arrangeOverlay` handed the same `viewRect` object to every anchored overlay and the root.
  - `checkRange` returned unless _both_ bounds were numbers, letting `{type: "Slider", min: 5}`
    through with an inverted range against the default `max` of 1.
  - The Slider branch of `measure` measured children outside layout, whose `resolved` is whatever
    the last frame that painted them left behind.
