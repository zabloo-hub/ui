# Overlay

Content lifted out of the normal flow into the view's **overlay layer**. It is declared in
place — wherever the UI that opens it lives — but it never affects its siblings' layout:
the SDK collects every visible `Overlay` of the view into ONE layer painted above the whole
tree, sorted by `(z, document order)`.

```jsonc
{
  "type": "Overlay",
  "visible": { "bind": "ui.confirmQuit" },
  "modal": true,
  "onDismiss": "quit-cancelled",
  "layout": { "justify": "center", "align": "center", "padding": 24 },
  "style":  { "background": "#00000099" },
  "children": [ /* the panel */ ]
}
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `modal` | `boolean` | `true` | Blocks input below and confines focus to this subtree. |
| `z` | `number` | `0` | Explicit stacking within the layer; ties break by document order. |
| `onDismiss` | `string` | absent | Named action fired on a dismiss request. |
| `autoCloseMs` | `number` | absent | Milliseconds before the overlay requests its own dismissal. |
| `anchor` | `OverlayAnchor` | absent | Places the content against another node's rect. See [Anchoring](#anchoring). |
| `children` | `ZNode[]` | `[]` | The content. |

## The layer

**The overlay's own rect IS the view rect.** So:

- `layout.justify` / `align` / `padding` **position the content** — a centered modal, a
  bottom-right toast, an inset that keeps it off the screen edges.
- `layout.width` / `height` on the overlay itself are **ignored**: a layer is not sized.
  Size the child instead.
- `style.background` **is the backdrop**. A translucent color dims what it covers; no
  background at all makes a transparent layer. Paint stays implicit, with no extra field.

## Opening and closing

**`visible` is the only mechanism**, exactly as everywhere else in the format. A hidden
overlay contributes no layer, no backdrop and no input blocking.

Bind it and the game opens the dialog by moving a boolean:

```tsx
<Modal visible={{ bind: "ui.confirmQuit" }} onDismiss="quit-cancelled">…</Modal>
```

A **dismiss request** — Escape, gamepad B, a tap on a modal's backdrop, or `autoCloseMs`
running out — is handled by the SDK writing `false` back through that binding *and* firing
`onDismiss`. That is what lets closing be expressed without a mechanism of its own: the
game's data is the single source of truth for what is open.

`autoCloseMs` is a plain number, not a `Dim`: it is a behavior timeout, not motion, and
nothing about it is themeable the way a transition's duration is. Its clock starts when the
overlay enters the layer and resets if it leaves and returns.

## Modality

`modal: true` (the default) does two things that are really one statement — *this is the
only thing you can interact with right now*:

- **Input capture.** Hit-testing runs the layer first, top-down, and a modal overlay
  captures the point: everything below it, lower overlays included, is unreachable.
- **Focus trap.** Directional navigation is confined to this subtree, and closing restores
  the focus to whatever held it before. The trap **derives from `modal`** — there is no
  second field.

`modal: false` — a toast, a tooltip — paints above but leaves the layer's own rect **inert**:
only its children take events, everything else passes through to the tree below.

## Motion

A `transition` on an `Overlay` fades its **layer presence**: the SDK tweens the whole
entry's opacity as it enters and leaves, so a closing overlay stays on screen for exactly
one duration after `visible` went false.

`visible` itself never animates. An overlay on its way out is only pixels — input, focus
trap and timers all read the live layer, which it has already left.

## Anchoring

With an `anchor`, the content is placed against **another node's rect** instead of against
the layer. This is the one piece of layout in v1 that is relative to a rect the node does
not contain, which is why it is a field of its own and not a `justify`/`align` reading.

| Field | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | — | `id` of the node in this view to hang from. |
| `at` | `AnchorAt` | `"top"` | Preferred placement around the anchor. |
| `offset` | `Dim` | `8` | Distance between the anchor's edge and the content. |
| `trigger` | `"manual" \| "hover" \| "press"` | `"manual"` | What puts it in the layer. |

**`at`** takes the same nine names as the layer placement, read as *which side, aligned
how*:

- `top` / `bottom` — above or below, centered on the anchor's width. `top-left` and
  `top-right` are the same side, flush with the anchor's left or right edge; they are an
  alignment for a wide anchor, not a diagonal corner.
- `left` / `right` — beside the anchor, centered on its height.
- `center` — centered **on** the anchor, ignoring `offset`. A badge over an icon.

**Fit is deterministic, with no field of its own.** If the content does not fit on the
preferred side and the opposite one has room, it **flips**; then it is **clamped** into the
view. The overlay's own `layout.padding` is the margin it keeps from the view's edges while
clamping.

**The overlay's rect is still the view's**, so an anchored *modal* popover keeps its
backdrop and its capture.

**A tooltip never points at nothing.** If the anchor leaves layout (its `visible` went
false, its tab panel closed) or is entirely clipped away (scrolled out of a `ScrollView`),
the overlay leaves the layer too — with its exit fade, like any other close. An `id` that
resolves to no node is an authoring error, not runtime state: the SDK warns
(`unknown-anchor`) and falls back to the layer placement, so a typo degrades to a visible
overlay rather than to silence.

The layer placement is **always emitted alongside** an anchor, which is exactly what an SDK
that predates anchoring renders.

### Triggers

- **`manual`** — `visible` and nothing else.
- **`hover`** — the SDK shows it while the anchor is hovered **or focused**. One value for
  both, because they are the same thing through different devices: on a pad, focus *is*
  hover, so a hint reaches a controller without a second mechanism. `visible` still gates
  it (a bound `false` turns the hints off), the SDK never writes it back, and `autoCloseMs`
  is ignored — what dismisses it is leaving the anchor.
- **`press`** — the popover, below.

A `hover` or `press` trigger needs an anchor that **takes input** (a `Button`, a `Toggle`, a
`Slider`, a `Collapse` header). Hover lights up exactly the focusable set, so anything else
is never hovered nor focused — which is also what keeps the pointer and the gamepad seeing
the same hints.

### Popovers

`trigger: "press"` is the state no overlay owned before: `visible` could open one, but
nothing in the IR could **close** it in response to something the player did inside it —
which is exactly what a dropdown is. So the SDK owns an open flag per anchored overlay,
keyed by the relation, the way it already owns `Collapse.open` and `Toggle.checked`.

Normatively:

1. **Pressing the anchor toggles it.** The press that opens it is the one that closes it,
   so a trigger button behaves like a trigger button. The anchor's own `onClick` still
   fires — opening is behavior, never a substitute for the declared action.
2. **A dismiss request closes it** — Escape, gamepad B, a tap on the backdrop of a modal
   one. The same path `onDismiss` hangs off.
3. **A selection inside it closes it.** When an `"exclusive-check"` group inside the
   popover takes a new value, the popover closes: choosing *is* the gesture that ends it.
   This is what makes [`<Select>`](toggle.md#select-and-option) expressible as a composite rather than
   a primitive.
4. **Opening focuses the selection** — the checked option of that group, so the list opens
   where the player left it, scrolled to it; failing that, the subtree's `autofocus`.
   Closing gives the focus back to the anchor.

`visible` still gates it, and the SDK never writes `visible` back for a popover — the open
state is the SDK's, not the game's data. `autoCloseMs` is ignored: a menu is dismissed, not
timed out.

**Forward-tolerance:** an SDK that predates a trigger value reads it as `manual`, so the
dropdown sits open on the layer where its anchor put it — a visible, inert list rather than
a control that never appears.

## Behavior summary

**States:** `disabled` only, and only its **own** — an `Overlay` is where the inheritance
stops, being the top of its own input scope, so a modal declared inside a disabled panel
stays operable and dismissable. It is not focusable; its children keep their states.

**Actions:** `onDismiss`.

**Degradation:** as a `Container` — and this one is worth knowing: the content lands
**in the flow**, where it was declared, instead of on a layer. It shows, in the wrong place,
with no backdrop and no capture.

## Authoring

`<Overlay>` emits this node and nothing else: it has no positional slots, so there is no
convention a component would have to own. The three composites below are the ready-made
shapes, and they share these props:

| Prop | Type | Default | Description |
|---|---|---|---|
| `position` | one of the nine placements | per component | Placement on the layer, or **around** the anchor when there is one. |
| `anchor` | `string` | absent | `id` of the node to hang from. |
| `offset` | `Dim` | `8` | Distance from the anchor's edge. Ignored without an anchor. |
| `trigger` | `"manual" \| "hover" \| "press"` | per component | What puts it in the layer. |
| `z` | `number` | per component | Stacking within the layer. |
| `autoCloseMs` | `number` | per component | Self-dismiss delay. |
| `onDismiss` | `string` | absent | Named action on a dismiss request. |
| `panel` | `ContainerProps` | absent | The card, pill or bubble the content sits in. Takes a whole `Container`'s props, not just a `Style`, so its own `layout` is authorable. |
| `label` | `Style` | absent | Style of the `<Text>` a bare string is wrapped in. `<Toast>` and `<Tooltip>` only — a `<Modal>` never wraps its content. |

### `<Modal>`

Always modal: a full-view layer that dims what it covers, captures input and traps focus,
with the content in a centered panel. The component **is the backdrop** — `style` paints it
— which is why there is no `backdrop` prop; `panel` styles the card inside it.

```tsx
<Modal visible={{ bind: "ui.confirmQuit" }} onDismiss="quit-cancelled" transition={{ duration: 150 }}>
  <Text>Quit the game?</Text>
  <Row layout={{ gap: 8 }}>
    <Button onClick="quit-confirm" autofocus><Text>Quit</Text></Button>
    <Button onClick="quit-cancelled"><Text>Cancel</Text></Button>
  </Row>
</Modal>
```

Defaults: `position: "center"`, `modal: true`, `z: 0`. Give a child `autofocus` and it takes
the focus when the modal opens; the SDK gives it back when it closes.

### `<Toast>`

A transient message that floats over the UI without stealing it: non-modal, so the layer is
inert and the player keeps using what is underneath, and self-closing after `autoCloseMs`.

```tsx
<Toast visible={{ bind: "ui.saved" }} onDismiss="toast-closed" transition={{ duration: 200 }}>
  Game saved
</Toast>
```

Defaults: `position: "bottom"`, `modal: false`, `autoCloseMs: 3000`, `z: 10`. A bare string
is wrapped in a `<Text>`; pass nodes instead for an icon plus a message.

### `<Tooltip>`

The same non-modal layer, smaller and without a timer.

```tsx
<Button id="jump-btn" onClick="jump"><Text>Jump</Text></Button>
<Tooltip anchor="jump-btn" position="top">Press A to jump</Tooltip>
```

Defaults: `position: "top"`, `modal: false`, `z: 20`, and `trigger: "hover"` **when it has
an anchor** — a tooltip hanging from a control is a hint about that control, and showing it
while the player is on it is the whole point. `trigger="manual"` opts out.

Without an anchor it is placed on the layer and shown by its `visible` binding, which the
game moves when it decides the hint applies.

The `z` defaults are a convention of the authoring layer, not a taxonomy in the format: a
toast above a modal, a tooltip above both.
