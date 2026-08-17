# Spinner

An indeterminate activity indicator: a node whose children pulse in a **travelling wave** —
the three dots that breathe.

```jsonc
{
  "type": "Spinner",
  "period": "{motion.loop}",
  "min": 0.25,
  "easing": "ease-in-out",
  "layout": { "direction": "row", "align": "center", "gap": 6 },
  "children": [
    { "type": "Container", "layout": { "width": 8, "height": 8 }, "style": { "background": "{color.dot}", "radius": 4 } },
    { "type": "Container", "…": "bead 2" },
    { "type": "Container", "…": "bead 3" }
  ]
}
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `period` | `Dim` | `900` | Full cycle in ms. A `Dim`, so the loop is themeable. `<= 0` or non-finite freezes it. |
| `min` | `number` | `0.25` | Trough of the wave: the opacity multiplier at its dimmest, `0..1`. |
| `easing` | `Easing` | `"ease-in-out"` | Curve of the ramp up and back down. |
| `children` | `ZNode[]` | `[]` | The beads, in wave order — ordinary children in every other respect. |

## It does not spin

v1 has **no transform** — no translate, rotate or scale — so a rotating arc is not
expressible. What *is* expressible, and portable to every target down to the last decimal, is
a periodic modulation of `opacity`.

It is a node type because an **infinite loop is behavior owned by the SDK and keyed by
component identity**. That identity has to exist in the IR, and nothing else in the format
repeats forever.

## The wave (normative)

With `n` children, child `i` carries the phase

```
phase = frac(elapsed / period − i / n)
```

and the SDK **multiplies** its resolved `opacity` by

```
min + (1 − min) · spinnerPulse(phase, easing)
```

Multiplicative, like every other opacity in the system, so a bead authored at `opacity: 0.5`
still pulses — just dimmer.

`spinnerPulse` is a symmetric ramp: up over the first half of the cycle and back down over
the second, so the loop is seamless — `f(0) = 0`, `f(0.5) = 1`, and `f` approaches `0` again
as the phase completes. Phases outside `0..1` wrap, including negative ones, which is how a
bead's offset arrives. It is built on
[`easeProgress`](../format/motion.md#easing-normative) for the same reason that exists:
closed-form arithmetic is what keeps every target on the same number.

Reference implementation: `spinnerPulse` in `@zabloo/format`.

The beads keep their **normal layout** — the node's own `direction`, `gap` and `align` place
them like any container's children.

Because `period` is a `Dim`, a "reduce motion" theme freezes the spinner by moving one token.

## Behavior

**States:** `disabled` only, inherited. Not focusable, so nothing else applies. It keeps
spinning: `disabled` is about input, and a spinner takes none either way.

**Actions:** none.

**Degradation:** as a `Container` — the beads show, at rest. The degradation is the absence
of the loop, never a layout change.

## Authoring

```tsx
<Spinner />
<Spinner dots={5} size={6} period="{motion.loop}" min={0.15} />
<Spinner>
  <Container layout={{ width: 4, height: 16 }} style={{ background: "{color.dot}" }} />
  <Container layout={{ width: 4, height: 22 }} style={{ background: "{color.dot}" }} />
</Spinner>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `dots` | `number` | `3` | How many beads to build when you pass no children of your own. |
| `size` | `number` | `8` | Bead diameter in px (generated beads only). |
| `period` | `Dim` | `900` | Full cycle in ms. |
| `min` | `number` | `0.25` | Opacity multiplier at the wave's dimmest. |
| `easing` | `Easing` | `"ease-in-out"` | Curve of the ramp. |
| `dot` | `Style` | — | Style of each generated bead, merged over the default. |
| `children` | `ReactNode` | — | Your own beads, in wave order — replaces the generated dots entirely. |
