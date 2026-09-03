# Examples

Four zabloo projects and one Godot project. Each of the four is a normal `create-zabloo-app`
layout — `src/views/*.tsx` (one file, one view), `src/theme.ts` (tokens + variants), a
`zabloo.config.ts` — so anything you read here works the same in a project of your own. The
fifth is the engine end: it loads the envelopes the other four export.

Run any of them from the repo root:

```bash
pnpm --filter showcase-example dev      # http://localhost:5078
pnpm --filter showcase-example build    # dist/zabloo.ir.json — the IR itself
```

`dev` serves the web preview and re-exports on every save. The preview plays the part of
the **game**: it fills its bindings panel from the envelope's bindings, logs the named
actions your UI fires in the console's **Actions** tab, and exposes the live handle as
`window.zabloo`, so the browser console can push data
(`zabloo.setData("player.gold", 900)`) exactly the way a game's own code would. Add
`--godot` to push each save to a running Godot game as well (or `--unity`, to the Unity
editor).

## Which one to open

| Project | Open it to see |
|---|---|
| [`showcase`](showcase/README.md) | **The whole catalog**, one view per capability. Start here to look something up. |
| [`hello-button`](hello-button/README.md) | The smallest whole project: one screen, one bound value, one action. Start here to read one. |
| [`inventory-demo`](inventory-demo/README.md) | A real screen built on data: hundreds of virtualized rows, a horizontal strip, a Collapse inside a scroller. |
| [`settings-screen`](settings-screen/README.md) | A real screen built on controls: tabs, toggles, sliders, a dropdown and a text field, all bound. |
| [`godot-playground`](godot-playground/README.md) | **The engine end.** A Godot project that loads the four above, one at a time, so every capability can be checked where it actually ships. |

The showcase is exhaustive and the other two zabloo projects are realistic; they are
different questions. "How does `maxLines` behave?" is a showcase question. "How do I lay a
shop out?" is an `inventory-demo` question.

## The showcase's nine views

Pick them from the view selector in the preview's topbar.

| View | What it covers |
|---|---|
| `layout` | The Yoga subset: direction, justify, align, gap, padding, sizes, `grow`, `wrap`, and `clip`. |
| `typography` | The six text style props: `wrap`, `textAlign`, `textAlignY`, `lineHeight`, `maxLines`, `overflow`. |
| `controls` | Button, Checkbox, Switch, RadioGroup, Select, TextInput, Slider on both axes, and the three `group` behaviors. |
| `lists` | `<List>` and `<Grid>` over the `Repeat` primitive: keys, the empty slot, nested item scopes, virtualization. |
| `overlays` | Modal, Toast, Tooltip, the raw `<Overlay>`, the nine anchor placements, flip/clamp, and the popover. |
| `motion` | `transition`, the four easing curves side by side, ProgressBar, Spinner, Badge, animated layout. |
| `media` | `<Image>`: intrinsic size, the three `fit` modes, tint, radius, and the background as a placeholder. |
| `theming` | Tokens, variants, the normative state merge order, and the state matrix. |
| `navigation` | Spatial focus, `autofocus`, focus trapped by a modal, and the focus dragging a scroller. |

Several views need data before they show anything — the document carries structure, the game
carries content. Each file's header comment has the `zabloo.setData(...)` lines to paste into
the browser console.

## Related

- [Getting started](../docs/getting-started.md) — build one of these from an empty folder.
- [Component catalog](../docs/components/README.md) — one page per node type.
- [Format reference](../docs/format/envelope.md) — the envelope, and the rules a loader follows.
- [`golden/`](../golden/README.md) — the cross-target corpus. The goldens **measure**; these
  examples are **looked at**. What an example uncovers should end up in the corpus.
