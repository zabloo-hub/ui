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

## Cancelled gestures (normative)

A pointer does not always end in a release: a touch can be interrupted by the system, a
browser gesture can take the pointer away, a device can be unplugged mid-press. Every
gesture in flight **ends, and none of them concludes**:

| In flight | On cancel |
|---|---|
| A press on a `Button`/`Toggle` | Released without activating — no action, no value moves |
| A drag on a `ScrollView` | Stops; the offset it reached stays |
| A selection drag in a `TextInput` | Stops; the selection it reached stays |
| A press on a modal's backdrop | Nothing is dismissed |
| A `Slider` drag | **Settles**: `onCommit` fires |

The `Slider` is the one exception because its value is *already* on screen and was written
into its bound path on every move: refusing the commit would leave the game without the
"apply the expensive thing" event for a value the player really did leave there. The others
had produced nothing yet, so producing it now would be inventing an intention.

This is the same rule as a press released outside its control, and it applies to the pad:
a controller unplugged mid-press cancels it, and a `Slider` it was nudging settles.

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

## Focus in a virtualized list (normative)

A [`Repeat`](../components/repeat.md) only realizes the rows its viewport can show, so
scrolling a list **destroys** the row that holds the focus. That is the renderer recycling a
node, not the player giving up the focus, and the two must not be confused: the focus
becomes **logical** and is remembered as the *item* it sat on — the list, the item's
identity, and where inside the row it was.

While the row is not realized:

- **Nothing wears the focus.** No node paints focused, and pressing the activation button
  does nothing — there is no control on screen to activate.
- **The focus is not given away.** It never falls back to the view's `autofocus`. A focus
  that jumps to the other end of the screen because the player scrolled a list is a bug, and
  the wheel, a drag and the right stick all produce it.
- **The list keeps scrolling.** The stick still moves the `ScrollView` the focus was in, so
  the gesture that pushed the row out of view is not cut halfway through it.

The row **takes the focus back** when it is realized again, on the same node — identity, so
with a `key` it follows the item across a reorder. Two things end the wait instead: a
**direction** (the player asked to move, and there is no rect to move from, so the walk
starts again from the scope's `autofocus`) and any **real focus decision** — a tap, an
opening modal, the game.

## Keyboard

| Key | Effect |
|---|---|
| Arrows | Move focus, per the algorithm above. |
| Enter | Activate the focused node — press a `Button`, toggle a `Toggle`, submit a `TextInput`. |
| Space | **Presses the focused node, exactly like Enter** — down on the keypress, activated on the release. Inside a `TextInput` it is a character instead. |
| Escape | Dismiss request to the topmost modal overlay. |
| Text keys | Edit the focused `TextInput`. |

Enter and Space are one intention, and it is the gamepad's A: the press lights the
`pressed` state on the way down and activates on the way up, so a release that never comes
(the focus moved, the pad was unplugged) cancels rather than fires. Auto-repeat is ignored —
holding the key does not activate twice.

### While a `TextInput` has the focus

A focused field claims the keys that edit it **before** anything above sees them; what it
does not claim falls through to the ordinary handling.

| Key | Effect |
|---|---|
| ← → | Move the caret one character; with a selection up, **collapse** to the edge it was pushed against rather than also stepping. **With Shift**, extend the selection instead. With nothing selected and the caret already at that end, the field gives the key back and the focus leaves it. |
| Home / End | Caret to the start or the end of the line. **With Shift**, select up to it. |
| Cmd/Ctrl + ← → | Same as Home/End — and the same Shift behavior. |
| Cmd/Ctrl + A | Select the whole value. |
| Backspace / Delete | Delete the selection when there is one; otherwise one character, backwards or forwards. |
| Enter | Fire `onSubmit`. It never inserts a newline: the field is one line in v1. |
| Space | A character, so it does **not** press anything. |
| Tab | Swallowed. Navigation here is spatial, so a Tab would only hand the keyboard to whatever the page has next and leave the field still looking focused. |
| ↑ ↓ | **Not claimed** — a field is one line, so the vertical arrows navigate out of it like anywhere else. |
| Cmd/Ctrl + C / X / V / Z | **Not intercepted** — the platform's own field performs them and the edit comes back through its input event. |

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
control — including a disconnected pad — cancels instead of activating, and a `Slider` it
was nudging settles (above).

Which physical control fills each of those roles is the SDK's business, not the format's: a
target reads its engine's own standard mapping out of the box and lets a game point a role
at something else — see [the Godot spelling](host-channel.md#the-gamepad-and-remapping-it).

## Who the keys belong to (normative)

The pointer is scoped to its own surface by construction. The keyboard and the gamepad are
not — keys are a page event and the pad is a page-wide device — so who reads them is two
questions, asked in this order.

### The host's own focus comes first

A view is rarely alone: around it there are the host's own controls — a toolbar, a panel, a
text field — and each of them is entitled to the keys while it holds the focus. **The
renderer reads a key only when the host's focus is on the view itself, or on nothing.** On
anything else it not only refuses to act: it must **not** consume the key either, because
suppressing it is what stops the host from turning that Enter into a press of the button
that has the focus.

"On the view itself" covers two things: the **surface** the view draws on, and the
**editable element the platform types through** on the targets that need one — the web
renderer's hidden field, which has to live outside the canvas because a canvas cannot
compose IME, so a focused `TextInput` is exactly the case where keys legitimately arrive
with something else focused.

The surface is **focusable** (`tabindex` on the web), so the focus can enter and leave the
view the way it enters and leaves any other control, and pressing it takes the focus as
well as the input.

### And then, which view

When the focus points at no view in particular, more than one may be mounted, and
**exactly one of them owns input**:

- The **first view mounted** owns it, so a page with a single view behaves as if the rule
  did not exist.
- **Touching a view hands it over**: a press anywhere on its surface, whatever it lands on.
  Pressing nothing in particular is still using that view.
- **Focusing a view's surface hands it over too**, so the two questions can never point at
  different views.
- **Disposing the owner** hands it to the oldest view left, and releases the host's focus if
  it was holding it.

Ownership is not derived from the host's focus, which is why it is a separate question: a
view nobody has clicked yet, on a page whose focus is on nothing, still reads the keyboard.

Everything else stays per view. Each one keeps its own focus, its own hover and its own
scroll offsets — these two questions decide who *hears* the keys and polls the pad, not
where the focus lives.

## What the game drives

Focus, hover, press, scroll offset, open/checked/selected state and the text in a field are
**runtime state owned by the SDK**. None of it is serialized into the IR, and none of it
survives a reload as authored data.

The game reaches it through the SDK's host API rather than through the format — see
[Bindings & actions › The host channel](bindings.md#the-host-channel).
