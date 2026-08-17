# Input & focus

Because the SDK draws the geometry, it also owns **hit-testing**, **focus** and
**directional navigation**. None of it is authored: there is no focus map in the IR, no
neighbor wiring, no tab order. A UI navigates with a gamepad because of what it *is*, not
because someone wired it.

## Hit-testing

**A node's input region is its layout rect.** Not its painted geometry — which is why the
format keeps the invariant that nothing paints outside its rect: the two would otherwise
disagree, and the disagreement would be invisible.

The resolution order for a point:

1. **The overlay layer, top-down.** Overlays are tested before the tree, in reverse layer
   order. A `modal` overlay **captures** the point: everything below it — lower overlays
   included — is unreachable, which is what makes a backdrop a backdrop. A non-modal
   overlay only takes the point if it lands on one of its children.
2. **The tree**, deepest node first, later siblings winning over earlier ones (they paint
   last).

**Clipping cuts input.** A node's effective clip is the intersection of every ancestor
clip, and a point outside it prunes that whole subtree — a row scrolled out of a
`ScrollView` is neither drawn nor tappable. Overflow that is *not* clipped stays reachable:
only a clip cuts input, exactly as only a clip cuts paint.

**Corner radius is respected.** A clip's rounded corners cut the input region too, so a
tap in the corner outside a rounded panel falls through to what is behind it.

Once a node is hit, the event is attributed to the nearest **focusable ancestor** — a tap
on the `Text` inside a `Button` is a tap on the `Button`.

## Focusability

Focusability derives from **component identity**. There is no `focusable` prop:

| Focusable | Not focusable |
|---|---|
| `Button` | `Container`, `Text`, `Image` |
| `Toggle` | `ScrollView` |
| `Slider` | `Overlay` |
| `TextInput` | `Repeat`, `ProgressBar`, `Spinner` |
| A `Collapse`'s header (`children[0]`) | `Collapse` itself |

**Hover lights up exactly the same set.** What takes input is what may look different
under the pointer, so a pointer over a plain `Container` hovers nothing, and a mouse and a
gamepad see the same set of live controls. This is what lets a
[`Tooltip`](../components/overlay.md#tooltip) triggered by `hover` reach a controller
without a second mechanism — on a pad, focus *is* hover.

## `disabled` (normative)

`disabled` is the **one exception** to the rule above: a node that carries it is not
focusable whatever its type is.

```jsonc
{ "type": "Container", "disabled": { "bind": "settings.custom" }, "children": [] }
```

It **inherits**: the effective value of a node is its own `disabled` **or** any ancestor's,
the way a clip is the intersection of every ancestor's. One prop on a section therefore
switches off the form inside it — which is the case it exists for — and an `Overlay`
restarts the chain, because a layer entry is the top of its own input scope. A modal
declared inside a disabled panel is still operable, and still dismissable.

Everything the interaction model does with it follows from being out of the focusable set:

- **No focus, no hover.** It is not a navigation candidate, so the arrows and the d-pad walk
  past it, and the pointer lights nothing up.
- **No press, no action.** Neither a tap nor Enter nor the gamepad's A activates it, so no
  named action fires and no value moves. A press that lands on it **falls through** to
  whatever is behind: a dead `Button` inside a `ScrollView` does not swallow the drag that
  scrolls the list.
- **What it held, it releases.** A control the game disables while it has the focus, the
  hover or a finger on it loses all three. The focus goes to *nothing* rather than to a
  neighbor — the player did not ask to move — and a `Slider` gesture in flight is
  **cancelled**, not committed: the value never settled.
- **A disabled section is still readable.** Scrolling is not an interaction a control owns,
  so a [`ScrollView`](../components/scrollview.md) inside one keeps working. A player who
  cannot use a panel must still be able to read it.
- **The game is not blocked.** The host channel is out of band, like a `SetData` on a bound
  path: `SetValue`/`SetScroll` still reach a disabled node. What `disabled` describes is
  what the **player** can do.

It styles nothing by itself. There is no built-in dimmed look, exactly as for every other
state — what a disabled control looks like is `states.disabled.style`, and a node with no
override declared paints unchanged. See [Style › States](style.md#states).

## Initial focus

`autofocus: true` marks the node that takes focus when its scope opens. The first one in
document order wins.

A [popover](../components/overlay.md#popovers) is the exception: it opens on its
**selection** — the checked option of the group inside it, so a list of twenty languages
opens where the player left it — falling back to the subtree's `autofocus`, and then to its
first focusable. A menu the player opened is a menu they are in, and one that starts with
no focus could not be walked with the arrows at all. The list also scrolls to whatever it
lands on.

## Directional navigation (normative)

Focus moves on one axis at a time — up, down, left, right — and the target is computed from
the **live layout rects**, so it survives a relayout, a hot-update, or a `Collapse` that
just changed the shape of the screen.

For a direction `(dx, dy)` and the currently focused node, over every focusable candidate
in the current scope:

1. Take the vector between the two rects' **centers**: `(deltaX, deltaY)`.
2. `projection = deltaX·dx + deltaY·dy` — how far the candidate lies *in the direction of
   travel*. A candidate with `projection <= 0.5` is discarded: it is not that way.
3. `orthogonal = |deltaX·dy| + |deltaY·dx|` — how far off-axis it sits.
4. `score = projection + orthogonal · 2`. The **lowest score wins**.

Weighting the orthogonal distance double is what makes the nearest control *in that
direction* win over a slightly closer one that is mostly sideways — the behavior a player
expects from a console UI.

With no focus at all, a direction takes the scope's `autofocus`, or its first focusable.

**Auto-reveal.** When focus lands inside a `ScrollView`, the scroller brings it into view.
It bubbles: each scroller reveals the child of its own that contains the focus. Without it,
navigation would walk into rows that are scrolled out of sight, and a pad has no wheel to
go looking for them.

## Focus scope and the trap

The scope is normally the whole view. While a **`modal` overlay** is up, the scope is that
overlay's subtree: navigation cannot leave it, and it cannot reach anything behind it.

The trap **derives from `modal`** — there is no separate field for it. It is the same
property that makes the overlay capture pointer input, because they are the same statement:
*this is the only thing you can interact with right now*. A non-modal overlay (a toast, a
tooltip) traps nothing, and its own buttons are ordinary candidates in the view's scope.

Closing an overlay **restores** the focus to whatever held it before.

## Keyboard

| Key | Effect |
|---|---|
| Arrows | Move focus, per the algorithm above. |
| Enter | Activate the focused node — press a `Button`, toggle a `Toggle`, submit a `TextInput`. |
| Escape | Dismiss request to the topmost modal overlay. |
| Text keys | Edit the focused `TextInput`. |

Two controls claim the arrows for themselves, and they do it differently on purpose:

- A **`Slider`** takes the arrows **on its own axis** and never gives them back — the
  cross-axis ones keep navigating. Stepping through a range is what those keys are for
  while a slider has the focus.
- A **`TextInput`** takes the arrows to move its caret, but **gives them back at the
  extremes**: at the end of the text, one more press leaves the field. Walking out of a
  long string one keypress at a time is not a reasonable price, and a text field is not a
  place to be trapped.

Navigation is spatial, so there is no Tab order to implement.

## Gamepad

The gamepad is **one more source of input**, not a second input model. Everything it reads
resolves to an intention the keyboard already produces, and both go through the same
handlers — which is what keeps "navigate with the d-pad" and "navigate with the arrows"
from drifting apart.

| Control | Intention |
|---|---|
| D-pad / left stick | A unit direction — the arrow keys' own move. |
| A | Press/activate the focused node (Enter). Releasing it releases the press. |
| B | Dismiss request to the topmost modal (Escape). |
| Right stick | Scroll the `ScrollView` the focus lives in. |

Reference values, shared by every target (`gamepad.ts`): navigation dead zone `0.5` with
release at `0.35` (the gap is hysteresis — a stick resting on the threshold must not fire
repeatedly without moving), scroll dead zone `0.15`, hold-to-repeat after `400 ms` at one
step every `90 ms`, and a scroll speed of `1100 px/s` at full deflection.

The pointer's cancel gesture applies to the pad as well: a press that ends outside the
control — including a disconnected pad — cancels instead of activating.

## What the game drives

Focus, hover, press, scroll offset, open/checked/selected state and the text in a field are
**runtime state owned by the SDK**. None of it is serialized into the IR, and none of it
survives a reload as authored data.

The game reaches it through the SDK's host API rather than through the format — see
[Bindings & actions › The host channel](bindings.md#the-host-channel).
