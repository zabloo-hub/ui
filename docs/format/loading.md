# Loading

Content is delivered to live games and hot-updated independently of the SDK, so an SDK
will eventually be handed a payload it was not built for — newer, older, truncated by a bad
download, or simply wrong. **A corrupt envelope must never take the game down.**

The policy below is one policy, implemented once in `@zabloo/format` (`readEnvelope`) and
ported literally by every SDK. Both targets degrade the same way in front of the same
bytes, and a consumer that loaded an envelope can trust its shape instead of defending
itself at every node, every frame.

## Three levels

The line between them is one question: **is there still a tree to render?**

| Level | What it covers |
|---|---|
| `fatal` | Invalid or truncated JSON, not an object, a missing or non-numeric `v`, an incompatible major version, a missing `views` map, and zero usable views once everything else is repaired. |
| `warn` | Everything repairable locally: a view that is not a node, a malformed node, a prop of the wrong type, an invalid asset entry, a dangling token/asset/anchor reference, a duplicate id, a subtree nested too deep. The envelope loads without them. |
| *silence* | **Unknown properties and unknown node types.** Forward-tolerance is a feature, not an error. |

## Shapes, never vocabularies

A closed set — `Easing`, `ImageFit`, `AnchorAt`, `GroupBehavior`, `ScrollAxis`… — is checked
to be a *string*, and no further.

The vocabulary is exactly what a later version grows, and every consumer already falls back
to its default on a value it does not know. Validating the value here would turn tomorrow's
content into today's error, which is the opposite of what the validator is for.

## The result is repaired, not just reported

`readEnvelope` returns a **copy** with the broken parts removed. The caller's object is
never mutated, and unknown properties survive the copy untouched.

Two repairs are worth knowing about:

- **A dropped positional slot is replaced by an inert empty `Container`.** `Collapse`,
  `Toggle`, `Slider`, `ProgressBar` and `Repeat` read their children *by position*, so
  removing a broken one would renumber the rest and silently change what they mean. A
  placeholder keeps the numbering honest.
- **A prop of the wrong type falls back to its default** rather than dropping the node.

The read is also depth-capped at **256 levels**: nothing authored comes close, but every
pass downstream — validation, layout, paint, hit-testing — is recursive, so a tree that
would overflow the stack stops being a tree at the door. The cut is an ordinary warning:
that subtree is dropped, the rest of the UI loads.

## Diagnostics

Every finding carries a **stable `code`** — that is the contract, not the prose of the
message — plus a `path` into the envelope (`views["hud"].children[2].text`), and a
self-contained human-readable message naming the field and the reason. Map keys are
bracketed because view ids, asset ids and token names contain dots of their own.

| Code | Level | Meaning |
|---|---|---|
| `invalid-json` | fatal | The payload is not parseable JSON. |
| `not-an-object` | fatal | The payload is not an object. |
| `missing-version` | fatal | No `v`, or `v` is not a number. |
| `unsupported-version` | fatal | The major version is one this reader does not implement. |
| `missing-views` | fatal | No `views` map. |
| `no-usable-views` | fatal | Every view was dropped during repair. |
| `invalid-tokens` | warn | The token dictionary is not an object. |
| `invalid-token` | warn | A token value is neither a string nor a number. |
| `invalid-assets` | warn | The asset manifest is not an object. |
| `invalid-asset` | warn | An entry is missing `hash`/`mime`/`size`, or `data` is not base64. |
| `invalid-node` | warn | A node is not an object, or has no usable `type`. |
| `invalid-prop` | warn | A property has the wrong type; it falls back to its default. |
| `invalid-binding` | warn | A binding's path is malformed. |
| `too-deep` | warn | The subtree exceeds the depth cap. |
| `duplicate-id` | warn | Two nodes in a view share an `id`. |
| `unknown-token` | warn | A `{token}` the dictionary does not define. |
| `unknown-asset` | warn | An `asset:` ref with no manifest entry. |
| `unknown-anchor` | warn | An overlay anchor `id` that matches no node. |

Asset entries are checked by **shape only** — `data` is never decoded during validation,
since that would pay the cost twice.

## What consumers do with it

- **Mounting throws** on a fatal diagnostic. There is no previous UI to protect, and the
  caller has to hear that its payload never became a view. The error message is the fatal
  diagnostic's, and it carries the warnings found on the way there.
- **Reloading never throws.** A hot-update the validator refuses is reported and
  **discarded**: the envelope on screen stays exactly as it is. A bad update costs the
  player an update, never their session.
- **Export validates before writing.** A fatal diagnostic aborts the export; warnings go
  into its summary. What it writes is the **author's** tree, never the repaired one —
  silently dropping a node from the artifact would hide the bug the warning just named.

- **Where they are reported is the host's choice.** The web renderer takes an
  `onDiagnostic` callback (`mount` and `reload` alike) that receives these objects —
  code, path and all — so an error overlay, a dev server or an editor can show them
  where the author is looking. With no callback they go to the console.

Warnings are emitted **once, at load**, not per frame.

## Forward-tolerance (normative)

What an SDK does with content built for a newer version of the format:

| Situation | Behavior |
|---|---|
| **Unknown property** | Ignored, silently. It survives a validation round-trip untouched. |
| **Unknown node type** | Rendered as a `Container`, preserving `layout`, `style`, `visible`, `disabled` and `children`. |
| **Unknown value in a closed set** | Falls back to that property's default. |
| **Unknown `group` behavior** | Ignored — the children lay out as ordinary siblings. |
| **Incompatible major version** | Refused: `unsupported-version`, fatal. |

The unknown-type rule is what makes the node vocabulary growable. A new primitive lands in
an old SDK as a plain box holding its children — the layout survives, only the new
capability is missing. It is also why every primitive is designed so that its `Container`
degradation is a reasonable picture of it: a `Repeat` becomes one static copy of its
template, a `ProgressBar` becomes its track with an unsized fill, a `Spinner` becomes its
beads at rest.

See [Versioning](versioning.md) for which changes are allowed to rely on this and which
ones are not.
