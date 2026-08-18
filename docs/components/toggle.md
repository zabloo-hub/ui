# Toggle

A two-state control. The checkbox, the switch and the radio are **one node type**: they
differ in styling and in the group they sit in, not in behavior.

```jsonc
{
  "type": "Toggle",
  "id": "sfx",
  "checked": { "bind": "settings.sfx" },
  "onChange": "sfx-changed",
  "layout": { "direction": "row", "align": "center", "gap": 10 },
  "children": [
    { "type": "Container", "…": "the checked indicator" },
    { "type": "Container", "…": "the unchecked indicator" },
    { "type": "Text", "text": "Sound effects" }
  ]
}
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `checked` | `Bindable<boolean>` | `false` | Initial state, or a **read/write** binding. |
| `value` | `string \| number` | absent | This option's value inside an `"exclusive-check"` group. |
| `onChange` | `string` | absent | Named action fired after every change. |
| `children` | `ZNode[]` | `[]` | Positional slots — see below. |

## Indicator slots

Paint is implicit — there is no draw-command layer — so the check or the knob is
**composed**, not drawn by a new primitive:

| Slot | Shown |
|---|---|
| `children[0]` | only while **checked** |
| `children[1]` | only while **unchecked** |
| `children[2..]` | always (the label) |

The slots enter and leave the layout with `display:none` semantics, the same mechanism as
`Collapse` content. A switch moves its knob by swapping two `justify`-ed slots; a checkbox
shows its tick. Each slot paints **the whole indicator as it looks in that state**, which is
what keeps the rule that nothing styles a descendant by state.

The two indicator slots **share one box** in the flow: they are measured as one item, taking
the larger of the two, and both receive the same rect. That is what lets them crossfade
without the label moving.

## Value

**Standalone**, a `Toggle` carries a boolean. `checked` may be a literal initial value or a
**read/write** binding: the SDK writes the new value into its data store and notifies the
game.

**Inside an [`"exclusive-check"` group](container.md#exclusive-check-normative)**, its
`checked` is **derived** from the group's `value` and never stored per node; tapping it
writes its own `value` into the group's binding.

## Behavior

**States:** `checked`, plus `hover`, `pressed` and `focused` — and `disabled`, its own or
inherited. A disabled toggle **keeps** its `checked` state: what it holds and whether the
player may change it are two different statements, which is why `disabled` merges last.

**Focusable:** yes. Activated by tap, Enter or gamepad A — none of which reach it while it is
[`disabled`](../format/input.md#disabled-normative).

**Actions:** `onChange`, fired after every change however it was caused — a tap, Enter, gamepad
A or the game's own `SetChecked`.

Inside an `"exclusive-check"` group it fires only when this option **takes** the selection: a
radio never turns itself off, so the one that loses it says nothing (its `checked` is derived,
and it was not the node that was acted on). What reports the move is the group's own
[`onChange`](container.md#exclusive-check-normative), which is where a `<Select>` or a
`<RadioGroup>` hangs its hook; with both declared, the option's fires first.

**Motion:** with a `transition`, the two indicator slots **crossfade**. The SDK tweens a
0..1 `checked` progress and multiplies each slot's opacity by it — `children[0]` fading in
as `children[1]` fades out — which is what the [shared box](#indicator-slots) is for: the
label never moves while the check appears or the knob is swapped. This is component behavior
driving the [motion engine](../format/motion.md) with endpoints it computes, not an
animatable prop; the multiplier composes with whatever `opacity` the slot declares. Without
a `transition` the progress is only ever 0 or 1 — one indicator, fully opaque.

**Degradation:** as a `Container` — **both** indicator slots show at once, plus the label,
since nothing is hiding one of them. The control is inert.

## Authoring

There is no `<Toggle>` component: the slots are positional, and the three controls below are
the one place that convention is written down. They share these props (`ToggleControlProps`):

| Prop | Type | Default | Description |
|---|---|---|---|
| `checked` | `Bindable<boolean>` | `false` | Initial state, or a read/write binding. |
| `onChange` | `string` | absent | Named action fired after every change. |
| `size` | `number` | `22` | Indicator size in px — the box side, or the switch track height. |
| `children` | `ReactNode` | absent | The label. Tapping it toggles too. |

### `<Checkbox>` and `<Switch>`

```tsx
<Checkbox checked={{ bind: "settings.sfx" }} onChange="sfx-changed">
  <Text>Sound effects</Text>
</Checkbox>

<Switch checked={{ bind: "settings.fullscreen" }}>
  <Text>Fullscreen</Text>
</Switch>
```

| `<Checkbox>` prop | Type | Default | Description |
|---|---|---|---|
| `box` | `Style` | absent | Box style in both states. |
| `checkedBox` | `Style` | absent | Box style while checked, merged over `box`. |
| `mark` | `Style` | absent | The mark inside a checked box. |

| `<Switch>` prop | Type | Default | Description |
|---|---|---|---|
| `track` | `Style` | absent | Track style in both states. |
| `checkedTrack` | `Style` | absent | Track style while checked, merged over `track`. |
| `knob` | `Style` | absent | The knob, at the start (off) or the end (on) of the track. |

### `<Radio>` and `<RadioGroup>`

`<Radio>` is a `<Checkbox>` with round corners and a **required `value`**; it has no
`checked` of its own, because the group owns the selection.

```tsx
<RadioGroup value={{ bind: "settings.quality" }} onChange="quality-changed" layout={{ gap: 8 }}>
  <Radio value="low"><Text>Low</Text></Radio>
  <Radio value="high"><Text>High</Text></Radio>
</RadioGroup>
```

`<RadioGroup>` emits a column `Container` with `group: "exclusive-check"` and the selected
`value` — usually a read/write binding. An older SDK ignores the group and leaves
independent checkboxes.

| `<RadioGroup>` prop | Type | Default | Description |
|---|---|---|---|
| `value` | `Bindable<string \| number>` | absent | The selection. A `<Radio>` is checked while its `value` equals it. |
| `onChange` | `string` | absent | Named action fired when the selection moves. |

**Put `onChange` on the group.** It is the node that holds the selection, so it is the one
that can report *what was picked*; a `<Radio onChange>` fires for its own option only, which
is a different (and rarer) question. Declaring both fires both, the option's first. See
[the group behavior](container.md#exclusive-check-normative) for what the action carries —
no value of its own: that comes back on the data channel.

### `<Select>` and `<Option>`

A dropdown: a button that opens a list of options in the overlay layer, anchored to itself,
and closes when the player picks one.

It is a **flattened composite, not a primitive** — a `Button`, a modal `Overlay` anchored to
it with `trigger: "press"`, and a `ScrollView` around the same `"exclusive-check"` group a
`<RadioGroup>` uses. The selection is one value, so it needed no mechanism of its own; what
the format gained for it was the [popover](overlay.md#popovers), which is what lets a choice
close the list.

```tsx
<Select id="lang" value={{ bind: "settings.lang" }} onChange="lang-changed">
  <Option value="es"><Text>es</Text></Option>
  <Option value="en"><Text>en</Text></Option>
</Select>
```

| `<Select>` prop | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | — | **Required.** The dropdown is anchored to the button by it. |
| `value` | `Bindable<string \| number>` | absent | The selection, usually a read/write binding. |
| `onChange` | `string` | absent | Named action fired after every change. It lands on the group inside the dropdown. |
| `width` | `number` | `220` | Width of the closed button and of the dropdown. |
| `maxHeight` | `number` | `240` | Cap on the dropdown's height; past it the list scrolls. |
| `position` | placement | `"bottom"` | Which side of the button the list opens on. It flips when it must. |
| `button` / `label` / `panel` | `Style` | absent | The closed button, its label, the dropdown panel. |

| `<Option>` prop | Type | Default | Description |
|---|---|---|---|
| `value` | `string \| number` | — | This option's value. Selected while it equals the `<Select>`'s. |
| `size` | `number` | `16` | Size of the check mark's box. |
| `mark` | `Style` | absent | The mark shown on the selected row. |
| `children` | `ReactNode` | absent | The row's content — usually a `<Text>`. |

An `<Option>` is the same `Toggle` a `<Radio>` lowers to, dressed as a list row: the mark
sits on the selected one and the row highlights through `states.checked`, with
`states.focused` above it so walking the list with the keyboard lights the row you are
**on**, not the one already chosen.

**The closed button shows the value**, through a `<Text>` bound to the same path — the IR
has no expressions, so there is nothing to look a label up with. Author the display strings
as the values when they are for the player to read. An empty value leaves the button blank,
and there is no placeholder for the same reason.
