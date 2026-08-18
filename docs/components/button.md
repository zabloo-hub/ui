# Button

An activation. It is the node that turns a gesture into a name the game hears.

```jsonc
{
  "type": "Button",
  "id": "buy-btn",
  "onClick": "buy",
  "layout": { "padding": "{space.3}", "justify": "center" },
  "style":  { "background": "{color.primary}", "radius": "{radius.md}" },
  "states": {
    "hover":   { "style": { "background": "{color.primary.hover}" } },
    "pressed": { "style": { "background": "{color.primary.pressed}" } },
    "focused": { "style": { "borderWidth": "{border.focus}" } }
  },
  "children": [{ "type": "Text", "text": "Buy", "style": { "color": "{color.on-primary}" } }]
}
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `onClick` | `string` | absent | Named action, fired on activation. |
| `children` | `ZNode[]` | `[]` | Ordinary flow children — a label, an icon, a row of both. |

A `Button` has **no label prop**: its content is its children, laid out by the ordinary
flex pass. A button with an icon and a text is a `Button` holding a `Row`.

## Behavior

**States:** `hover`, `pressed`, `focused`, and `selected` while it is the chosen button of
an [`"exclusive-select"` group](container.md#exclusive-select-normative) (a tab). Plus
`disabled`, its own or inherited.

**Focusable:** yes — unless [`disabled`](../format/input.md#disabled-normative), which takes
it out of the navigation and makes its `onClick` unreachable.

**Activation:** a tap, Enter while focused, or gamepad A. A press that ends **outside** the
control cancels instead of activating — dragging off a button is how a player takes it
back, and the same rule applies to a pad that disconnects mid-press.

**Actions:** `onClick`. Fired *after* the activation completes, with an
[action context](../format/bindings.md#action-context) when the button lives inside a
`Repeat` item.

**Degradation:** as a `Container` — the label still shows, the press is gone. `Button` has
existed since v1.

A button is also the natural **anchor** of a [popover](overlay.md#popovers): an `Overlay`
anchored to its `id` with `trigger: "press"` opens on the same press that fires `onClick`.
Opening is behavior; it never replaces the declared action.

## Authoring

```tsx
<Button onClick="buy" variant="primary" autofocus>
  <Text>Buy</Text>
</Button>

<Button id="menu-btn" onClick="menu-open">
  <Row layout={{ gap: 6, align: "center" }}>
    <Image src="icons/menu.png" />
    <Text>Menu</Text>
  </Row>
</Button>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `onClick` | `string` | absent | Named action the game subscribes to. |
| `children` | `ReactNode` | absent | Button content. |
