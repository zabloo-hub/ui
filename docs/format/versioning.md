# Versioning

An envelope carries one version number:

```jsonc
{ "v": 1, "tokens": {}, "views": {} }
```

**`v` is the major version, and it is the only version number in the format.** An SDK
implements exactly one major and refuses anything else.

This matters more here than in a library, because the two sides move independently: content
is hot-updated into games that shipped months ago, so an SDK receiving content newer than
itself is the normal case, not the edge case.

## The policy

| Change | `v` | What an older SDK does |
|---|---|---|
| **Additive** — the format grows | unchanged | Ignores what it does not know, renders the rest. |
| **Breaking** — the format changes its mind | bumped | Refuses the payload (`unsupported-version`, fatal). |

There is deliberately **no minor version**. A minor number could only tell an SDK "this
content uses things you may not know", and the answer to that is already written into the
format: it ignores them, by rules that are normative and tested. What an SDK actually needs
to decide is binary — *can I render this at all?* — and that is exactly what the major
answers. Every loader gets one comparison instead of two, and there is no second
compatibility rule to keep consistent across targets.

The cost is real and accepted: a v1 SDK cannot report "this content was built for a later
v1". It renders what it understands and stays silent about the rest, which is the same
thing it does for a prop that was simply left out.

## What is additive

These changes ship without touching `v`, because [forward-tolerance](loading.md#forward-tolerance-normative)
already defines what an older SDK does with them:

- **A new node type.** An SDK that does not know it renders it as a `Container` preserving
  `layout`, `style`, `visible` and `children`.
- **A new optional property**, on a node or in `Style`/`Layout`. Unknown properties are
  ignored silently, and absent means "the default", which is what the older SDK applies.
- **A new value in a closed set** (`Easing`, `ImageFit`, `AnchorAt`, `GroupBehavior`,
  `ScrollAxis`, `StateName`, `OverlayTrigger`…). The validator checks shapes, never
  vocabularies, and an unknown value falls back to the property's default.
- **A new group behavior.** Ignored, so the children lay out as ordinary siblings.
- **A new token in the dictionary**, a new asset entry field, a new diagnostic code.

A new capability is additive **only if its absence is a reasonable picture of the UI**. That
is a design constraint on every new primitive, not a property that comes for free: a
`Repeat` degrades to one static copy of its template, a `ProgressBar` to its track with an
unsized fill, a `Spinner` to its beads at rest. If a new node type would degrade to
something misleading — a control that looks operable but is not, a dialog that renders as
an opaque box over the screen — it is not additive, whatever its shape.

Emitting an additive feature is therefore an **authoring** decision: the content still
loads everywhere, and it looks complete only where the SDK is new enough.

## What breaks

These require a new major, because no forward-tolerance rule can absorb them — an older SDK
would render something *wrong* rather than something *incomplete*:

- **Removing or renaming** a node type, a property, or a value of a closed set.
- **Changing the meaning or the default of an existing property.** An old SDK keeps
  applying the old meaning to the same JSON, silently.
- **Changing a positional slot contract** — which child is a `Collapse`'s header, a
  `Toggle`'s checked indicator, a `Slider`'s thumb, a `Repeat`'s template. Slots are read
  by index, so a renumbering is invisible and total.
- **Changing the output of a normative algorithm**: the state merge order, the text wrap
  algorithm, the easing curves, the spatial navigation score, path resolution inside item
  scopes. Two SDKs on the same major must produce the same frame.
- **Making an optional property required**, or changing the shape of the envelope itself.
- **Turning a silent degradation into a refusal**, or the other way round.

Fixing a *bug* — where an implementation disagreed with this specification — is not a
breaking change. The specification is the contract; an implementation that did not match it
was already wrong.

## What SDKs do

```
supportsVersion(v)  ⟺  v is an integer and v === IR_VERSION
```

`IR_VERSION` is the major an SDK implements (`1` today). A mismatch — in **either**
direction — is fatal, reported as `unsupported-version`, and the payload never becomes a
view. Content older than the SDK is refused for the same reason as content newer than it: a
v1 SDK does not carry v2 semantics, and a v2 SDK does not keep v1's.

Refusal is not a crash. On a hot-update it is a discarded update — the UI already on screen
stays exactly as it is. Only a *first* mount of an unsupported payload surfaces as an error
to the host, because there is nothing on screen to protect.

## Package versions are a different number

The npm packages (`@zabloo/format`, `@zabloo/react`, …) and the engine SDKs follow ordinary
semver, and their versions are **not** the IR version. A package major may change for
reasons that have nothing to do with the format — a renamed export, a dropped Node version —
while the IR it reads and writes stays at `v: 1`.

The only number that decides whether a payload and an SDK can meet is the envelope's `v`.
