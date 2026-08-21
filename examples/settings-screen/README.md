# settings-screen

**A real screen built on controls.** The whole form catalogue — Tabs, Checkbox/Switch,
Slider, Select and TextInput — composed as *one* settings screen instead of a test bed
per control. Each control on its own, with every prop it takes, is
[`showcase`](../showcase) next door; this is what a game actually ships.

```bash
pnpm --filter settings-screen-example dev     # http://localhost:5078
pnpm --filter settings-screen-example build   # dist/zabloo.ir.json — the IR itself
```

## What it demonstrates

- **Every control is bound**, so the preview's bindings panel plays the part of the game:
  type a value there and the screen moves; move the screen and the field updates with a
  `← UI` chip on it (which is the game's `onDataChanged`). No control invents its own event.
- **Tabs relayout.** The unselected panels *leave* the layout — the same flag `Collapse`
  uses — so switching tabs re-runs the Flexbox pass and the screen recenters on the panel
  now showing.
- **`onChange` vs `onCommit` on a `<Slider>`.** Master volume previews continuously as the
  finger moves (`onChange`) and applies on release (`onCommit`); brightness is quantized to
  steps of ten, and the arrows walk that same grid while the slider holds the focus.
- **`<Select>` opens in the overlay layer**, anchored to the closed button, and closes on
  pick, on Escape and on a click outside. The language list is long enough to scroll:
  past `maxHeight` the dropdown is a `ScrollView`, and moving the focus drags it along.
- **`<TextInput>` is the box itself** — the SDK paints the caret, the selection and the
  placeholder inside it. `onSubmit` fires on Enter; ←/→ walk the caret before letting the
  focus leave the field. There is no commit-on-blur.
- **State overrides**: `states.empty` greys the placeholder, `states.focused` recolors the
  border — ordinary states, merged in the format's normative order.

Everything is reachable with the keyboard or a gamepad alone: arrows or d-pad to move,
Enter/Space/A to activate, Escape/B to close the dropdown — and with the mouse.

## Driving it

Paste into the browser console:

```js
zabloo.setData("settings.quality", "High")
zabloo.setData("settings.fullscreen", true)
zabloo.setData("settings.brightness", 70)
zabloo.setData("settings.volume", 80)
zabloo.setData("settings.music", 45)
zabloo.setData("settings.sfx", true)
zabloo.setData("settings.subtitles", true)
zabloo.setData("profile.name", "Ada")
zabloo.setData("settings.language", "English")
zabloo.setData("settings.hints", false)
```

Then move a slider or tick a switch and read the write in the log — that path and value
are exactly what a game's C# receives.

## Layout

```
src/
├── views/settings.tsx   one file, one view (the filename is the view ID)
└── theme.ts             tokens, per-component transitions, variants
```

Variants are keyed by **primitive**, which is why `<Checkbox>` and `<Switch>` both read
from `Toggle` and the tab buttons read from `Button`.

## Related

- [`Toggle`](../../docs/components/toggle.md) · [`Slider`](../../docs/components/slider.md) · [`TextInput`](../../docs/components/textinput.md) — the normative pages.
- [Input & focus](../../docs/format/input.md) — hit-testing, focusability, directional navigation.
- [`examples/README.md`](../README.md) — which example to open for what.
