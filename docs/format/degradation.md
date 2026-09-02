# Degradation

What a player sees when the SDK is older than the content it was sent.

[Versioning](versioning.md) says which changes are allowed to rely on
forward-tolerance, and [Loading](loading.md#forward-tolerance-normative) states the rules an
older reader follows. This page is the third thing: the **observed behavior**, capability by
capability, on real screens.

It exists because "additive" is a claim about what a UI looks like, not about the shape of a
type — and a claim about what a UI looks like has to be checked. Every row below was
produced by loading a `golden/` envelope into a build that does not have the capability, and
is pinned by `core/tests/test_forward_compat.cpp`, which runs on every PR.

## How an older build is synthesized

An older reader does not carry a switch that turns a capability off. It carries a **smaller
vocabulary** — so each row is one rewrite of the payload, spelling an identifier in a way
the build has never heard of:

```jsonc
"type": "Overlay"      →  "type": "Overlay@next"      // a type it does not implement
"transition": { … }    →  "transition@next": { … }    // a prop it never reads
"easing": "ease-out"   →  "easing": "ease-out@next"   // a value outside its closed set
```

Renaming rather than deleting is what makes it faithful: the payload keeps its shape, stays
valid JSON, and drives exactly the paths a real old SDK takes — the type resolving to
`Unknown`, the key ignored in silence, the closed set falling to its default.

## Node types

Every row: the corpus screen it was measured on, and what is left.

| Type | Measured on | Without it | Content lost |
|---|---|---|---|
| `Container` | — | — it *is* the fallback. A reader that lacked it could not render anything. | — |
| `Text` | `text-wrap` | The box stays where it was; **the string is gone**. Its content is a prop, and the fallback preserves children. | The text |
| `Button` | `gamepad-nav` | A box that keeps its label and its style. It takes **no focus** — focusability comes from identity — so a menu of them has nothing focused at all, and an `autofocus` pointing at one cannot seat itself. No action fires. | none |
| `Collapse` | `collapse-tabs` | **Every section is shown.** `open` is the prop it cannot honour, and showing is the safe way not to honour it. | none |
| `ScrollView` | `scroll-clip` | No clip and no offset: the content overflows its box instead of scrolling. | none |
| `Image` | `assets-image` | Where the author sized the node it keeps its box and paints its `background` — the authored placeholder. Where the size came from the manifest, it **collapses to 0 × 0**. | The picture |
| `Toggle` | `controls` | The two indicator slots stop sharing a box and become side-by-side siblings — both knobs visible at once, and the control grows. No `checked`. | none |
| `Slider` | `controls` | Track and thumb flow as ordinary children; the value no longer places anything. | none |
| `TextInput` | `textinput` | An empty box with its background and its place in the layout. A field's content is its value, not a child. | The value |
| `Overlay` | `overlays` | Renders **in the flow**, as an ordinary child of the node it was declared under. No layer, no backdrop, no capture, no trap. | none |
| `Repeat` | `repeat` | One static copy of its template **and** its empty state, both at once — a `Container` has no reason to choose between its children. Item bindings read nothing. | The rows |
| `ProgressBar` | `controls` | The track with its fill unsized. | none |
| `Spinner` | `controls` | Its beads at rest. | none |

Four of the thirteen lose something, and each loss is instructive rather than accidental:
`Text`, `Image` and `TextInput` are the nodes whose **content is a prop**, so a fallback
that preserves *children* has nothing to preserve; `Repeat`'s children come from the data,
so a reader that cannot follow `items` falls back to the only thing the document holds.

That is the rule in [Versioning](versioning.md#what-is-additive) at its sharpest: a new
content-bearing leaf has to earn a reasonable picture with its own box, because nothing else
will draw one for it.

## Properties, values and behaviors

| Capability | Measured on | Without it |
|---|---|---|
| `transition` | `transitions` | Values jump instead of tweening. The frame is the same; the way it got there is not. |
| `wrap` | `flex-layout` | The children lay out on one line, and the row overflows. |
| `clip` | `scroll-clip` | The subtree is no longer cut to its box — an authored `overflow: hidden` is gone; a `ScrollView`'s own clip is not. |
| `disabled` | `disabled` | The control is live again and styles itself as if it were. |
| `anchor` | `anchors` | The overlay falls back to layer placement, from the `justify`/`align` emitted alongside it. It also loses the **trigger**, which lives in the same object — so a tooltip that appeared on hover is simply always there. |
| `autoCloseMs` | `overlays` | The toast comes up and never leaves. |
| `onChange` | `controls` | The selection still moves and still writes to its bound path; the game is never told. |
| `selected` | `collapse-tabs` | The tab group opens on its first panel instead of the authored one. |
| `group` | `collapse-tabs` | The children lay out as ordinary siblings: every panel of an `exclusive-select` in the layout at once, every option of an `exclusive-check` independent. |
| An unknown `Easing` | `transitions` | The default curve. |
| An unknown `ImageFit` | `assets-image` | `contain`. |
| An unknown `ScrollAxis` | `scroll-clip` | `vertical` — so a horizontal strip scrolls the other way. |
| An unknown `AnchorAt` | `anchors` | The default placement. The bubble still lands somewhere; a placement it does not know is not the absence of one. |

## What is refused instead

One rule is not a degradation: an **incompatible major** is rejected outright
(`unsupported-version`, fatal), and nothing renders. On a hot-update that costs the update,
not the session — the UI already on screen stays exactly as it is.

That case is `future-major` in the corpus, and it is pinned in `core/tests/test_golden.cpp`
along with `unknown-type`, the recorded frame of the `Container` fallback itself.

## Two things this page cannot tell you

**A frame is not a film.** These rows were measured with a `ViewSnapshot`, which records
rects, styles, states and resolved values for **one frame**. Four capabilities leave no
trace in one, so their degraded frame is byte-identical to the full one and the loss lives
somewhere a frame cannot reach: `transition` (the motion, not the destination), `autoCloseMs`
(the toast going away), `onChange` (a call to the game is not a metric) and `ImageFit`
(`contain` and `cover` differ in UVs, and UVs are not rects). That is stated as its own case
in the test file rather than papered over, and it is why the corpus keeps golden *images* as
a separate manual step.

**Unknown properties do not survive this core.** The normative rule says an unknown property
is ignored and survives a validation round-trip untouched. The C++ core keeps the first half
and cannot demonstrate the second: it models the IR as typed structs and never reserializes,
so a prop nobody reads is dropped on load (2026-08-24). The round-trip half is
`@zabloo/format`'s, and is tested there.

## Where the evidence came from

Half of it was collected while the Godot batch was running, which is the only time it could
be: from G2 to G13 the core was a genuinely partial SDK being fed modern envelopes, and each
ticket recorded what its missing capability degraded to — the table in
`docs/internal/specs/2026-08-24-core-cpp-foundation-design.md` and the per-ticket entries in
the decision log.

The other half is `core/tests/test_forward_compat.cpp`, which keeps it true. It sweeps every
capability over the corpus and asserts that none of them is ever a refusal; it checks the
per-capability promises above; and it guards itself — a rewrite that matched nothing would
"prove" a perfect degradation for free, so a separate case verifies that every cut really
changes the payload it claims to.

Its headline is the one a reader most wants: `settings.json` is the whole F5 catalog composed
as one screen, and with **nine of the thirteen types unknown at once** it still loads, still
lays out, and still shows every id its author wrote.
