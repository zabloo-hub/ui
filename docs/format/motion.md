# Motion

A node may declare a **transition**, and then its animatable values tween instead of
jumping whenever they change.

```jsonc
{
  "type": "Button",
  "transition": { "duration": "{motion.fast}", "easing": "ease-out" },
  "style":  { "background": "{color.primary}" },
  "states": { "hover": { "style": { "background": "{color.primary.hover}" } } }
}
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `duration` | `Dim` | — | Milliseconds. A `Dim`, so motion is themeable (`"{motion.fast}"`). `<= 0` is instant. |
| `easing` | `"linear" \| "ease-in" \| "ease-out" \| "ease-in-out"` | `"ease-out"` | Curve of the ramp. |

`transition` lives on the node, not in `style`: `style` is the *what*, `transition` the
*how*. Because `duration` is tokenizable, a "reduce motion" theme stops the whole UI dead
without re-emitting a single node.

Keyframes and timelines are **not** in v1. This is the piece of an animation system the
format landed first, and the rest is deferred.

## There is no trigger list

**A resolved animatable value changed ⇒ it transitions.** Whatever caused the change:
entering or leaving a state, a `SetData` on a bound input, a token swapped by a theme
hot-update, a relayout that gave the node a new size.

This is what keeps the model small. There is nothing to declare about *when* to animate,
so there is nothing to keep in sync with the states, the bindings or the data.

## What animates

| Animates | Snaps |
|---|---|
| `background`, `borderColor`, `color` | `fontSize` — it keys the glyph atlas |
| `opacity`, `radius`, `borderWidth` | `textAlign`, `textAlignY`, `lineHeight`, `wrap`, `overflow`, `maxLines` — a re-wrap has no intermediate |
| `width`, `height`, `gap`, `padding` | `grow`, `direction`, `justify`, `align` |
| | `visible`, `clip`, `text`, `open`, `src`, `fit`, `axis`, `scrollbar` |
| | A control's value: `Slider`'s `value`/`min`/`max`/`step`, `TextInput`'s `value`/`placeholder`/`maxLength` |
| | `Overlay`'s `modal`, `z`, `autoCloseMs` |

A control's value snaps because it is state the player is dragging or typing, not a visual
magnitude to catch up with. `Overlay`'s `z` and `autoCloseMs` are numbers, but they are
ordering and timing.

**Colors** are interpolated componentwise in straight sRGB with straight alpha.

**Layout dimensions are interpolated as inputs**, before the layout pass — never as
computed rects. The SDK tweens the declared `width`/`height`/`gap`/`padding` and then runs
its ordinary layout with the interpolated values, so there is still exactly one layout pass
per frame and a computed rect never feeds back into its own input.

## Endpoints

- **Both endpoints must resolve.** An `undefined` (auto) endpoint has nothing to tween
  from or to, so the change snaps. Sizes and declared colors are where this shows up;
  `opacity`, `radius`, `borderWidth`, `gap` and `padding` have renderer defaults, so they
  always resolve and a state that introduces one still animates.
- **Mounting snaps**, and so does an envelope reload: there is no previous value to tween
  from.
- **An interruption retargets** from the value currently on screen, over a full duration —
  a button released mid-hover-fade continues from where it is rather than restarting.
- **An undeclared `borderColor` holds the last one** instead of dropping to no value. The
  border that is leaving is leaving through `borderWidth`, and a focus ring that lost its
  color halfway out would flash the missing-color magenta on its way.
- A node **out of layout** forgets its animation state; when it comes back, it snaps —
  there is no honest previous value for a node that was not on screen.

## No cascade

`transition` is read from the **base node only**. A node never inherits its parent's, and
a state override cannot carry one — an asymmetric in/out transition is a compatible future
extension, not v1 surface.

In authoring, motion resolves like a variant: node prop > variant > theme default for that
component, and the most specific declaration wins **whole** (it is one object, not a set of
fields to merge).

## Easing (normative)

Four curves, defined as closed-form cubic polynomials rather than CSS cubic-béziers, so
every target computes the same number without a solver:

| Curve | `f(t)` |
|---|---|
| `linear` | `t` |
| `ease-in` | `t³` |
| `ease-out` | `1 − (1 − t)³` |
| `ease-in-out` | `t < 0.5 ? 4t³ : 1 − (−2t + 2)³ / 2` |

`t` outside `0..1` clamps. An **unknown curve** — newer content on an older reader — falls
back to `linear` rather than refusing to animate.

Reference implementation: `easeProgress` in `@zabloo/format`.

## Motion a component owns

A component's own behavior may drive this same machinery with endpoints it computes. When
it does, the tween is part of that component's spec rather than a value of the animatable
set above — which is why none of these props appears in it:

| Component | What its `transition` does |
|---|---|
| [`ProgressBar`](../components/progressbar.md) | Tweens the **value**, then lays out the fill from it. The fill's rect is never the thing interpolated. |
| [`Spinner`](../components/spinner.md) | Loops forever on `period`, pulsing its children's opacity. The only thing in the format that repeats without end. |
| [`Overlay`](../components/overlay.md) | Fades its whole **layer presence** in and out, so a closing overlay stays on screen for exactly one duration after `visible` went false. |
| [`Collapse`](../components/collapse.md) | Animates its own height between closed and its content's natural height. |
| [`Toggle`](../components/toggle.md) | Crossfades its two indicator slots, which share a box. |
| [`Slider`](../components/slider.md) | Glides to a value the game pushed; a value the player is dragging never lags behind the finger. |

`visible` itself never animates. An overlay that is fading out is only pixels — input,
focus trap and timers all read the live layer, which it has already left.
