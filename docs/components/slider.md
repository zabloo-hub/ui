# Slider

A number the player sets **by pointing**, whose geometry is a function of that number
rather than of the flex pass. That is the capability it adds: nothing before it could
express "this child's size is this value".

```jsonc
{
  "type": "Slider",
  "id": "volume",
  "value": { "bind": "settings.volume" },
  "min": 0, "max": 1,
  "onChange": "volume-preview",
  "onCommit": "volume-apply",
  "layout": { "width": 200, "height": 6 },
  "style":  { "background": "{color.rail}", "radius": 3 },
  "children": [
    { "type": "Container", "…": "the fill" },
    { "type": "Container", "…": "the thumb" }
  ]
}
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `value` | `Bindable<number>` | `min` | Current value, or a **read/write** binding. |
| `min` | `number` | `0` | Lower end of the range. |
| `max` | `number` | `1` | Upper end of the range. |
| `step` | `number` | absent | Quantization step from `min`. Absent or `<= 0` = continuous. |
| `axis` | `"horizontal" \| "vertical"` | `"horizontal"` | Track orientation. Vertical runs **bottom-to-top**, like a fader. |
| `onChange` | `string` | absent | Named action fired on every value change. |
| `onCommit` | `string` | absent | Named action fired when a gesture **ends**. |
| `children` | `ZNode[]` | `[]` | Two positional slots — see below. |

## The node is the track

Its `style` paints the rail through the ordinary implicit paint — no new draw command, no
third slot — and it takes exactly two positional children that the SDK arranges **from the
value** instead of laying them out in flow:

| Slot | What it is | How the SDK places it |
|---|---|---|
| `children[0]` | the fill | from the track's start to the value's fraction |
| `children[1]` | the thumb | its own size, centered on the value's position |

The thumb's travel is **inset by half its own size**, so it never paints outside the node's
rect — the border-box invariant holds and hit-testing on layout rects stays honest.

A `Slider` **measures as a leaf**: the slots never contribute to its size. The track's
length and thickness come from its own `layout`, which is why an 18px thumb cannot define a
200px track.

## Value

`value` may be a literal initial number or a **read/write** binding: the SDK writes every
new value into its data store and notifies the game.

It is **clamped** to `[min, max]` and, with a `step`, **quantized** to `min + k · step`.
`max` is always a valid stop even when the range is not a whole number of steps — `0..1` by
`0.3` stops at `0.9` and then at `1`. The player can see the end of the track, so leaving it
unreachable would read as a stuck control; the price is a short last step, which is the
smaller surprise.

An unusable range (`max <= min`, NaN, a negative step) collapses to a fixed slider rather
than to an error.

## Two hooks

The two questions a game asks about a drag are different, so they are different actions:

- **`onChange`** fires on every change, however it was caused — the live hook. A volume
  preview follows the drag.
- **`onCommit`** fires when a gesture **ends** (pointer release, arrow key up): the value
  the player settled on. The expensive-to-apply setting — graphics quality, resolution —
  hangs here instead of the game debouncing `onChange` on its side.

A bound `value` is written on **every** change, continuously, regardless of which hooks are
declared.

## Behavior

**States:** `hover`, `pressed`, `focused`, plus `disabled` — its own or inherited. A gesture
in flight when the game disables it is **cancelled**, never committed: the value never
settled.

**Focusable:** yes, unless [`disabled`](../format/input.md#disabled-normative). It **keeps the
arrow keys on its own axis** and never gives them back;
the cross-axis arrows keep navigating. A continuous slider borrows a step of **5% of its
range** for the keyboard, so the arrows are usable without forcing authors to declare a
`step` they do not otherwise want.

**Motion:** with a `transition`, the SDK glides to a value the **game** pushed, and snaps to
one the **player** is dragging — a control must never lag behind the finger.

**Degradation:** as a `Container` — the rail, with an unsized fill and a thumb laid out in
flow. Inert.

## Authoring

There is no `<Slider>` primitive export: the two slots are positional, and the component
below is the one place that convention is written down.

```tsx
<Slider value={{ bind: "settings.volume" }} onChange="volume-preview" onCommit="volume-apply" />
<Slider min={0} max={100} step={10} axis="vertical" length={120} />
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `value` | `Bindable<number>` | `min` | Current value, or a read/write binding. |
| `min` / `max` | `number` | `0` / `1` | The range ends — the unit interval a volume or a ratio lives in. |
| `step` | `number` | absent | Quantization step. Absent = continuous. |
| `axis` | `"horizontal" \| "vertical"` | `"horizontal"` | Track orientation. |
| `onChange` / `onCommit` | `string` | absent | The live and the settled hooks. |
| `length` | `number` | `200` | Track length along its axis, in px. |
| `thickness` | `number` | `6` | Track thickness across its axis, in px. |
| `thumbSize` | `number` | `18` | Thumb size, in px. |
| `fill` | `Style` | — | The filled part of the track. |
| `thumb` | `Style` | — | The handle that rides the track. |

`length`, `thickness` and `thumbSize` are authoring conveniences that resolve into
`layout` and the two slots' sizes. An explicit `layout` still wins.
