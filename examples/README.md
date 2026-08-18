# Examples

Four zabloo projects and one Unity project. Each of the four is a normal `create-zabloo-app`
layout — `src/views/*.tsx` (one file, one view), `src/theme.ts` (tokens + variants), a
`zabloo.config.ts` — so anything you read here works the same in a project of your own.

Run any of them from the repo root:

```bash
pnpm --filter showcase-example dev      # http://localhost:5078
pnpm --filter showcase-example build    # dist/zabloo.ir.json — the IR itself
```

`dev` serves the web preview and re-exports on every save. The preview plays the part of
the **game**: it fills a data panel from the envelope's bindings, logs the named actions
your UI fires, and exposes the live handle as `window.zabloo`, so the console can push data
(`zabloo.setData("player.gold", 900)`) exactly the way a game's C# would. Add `--unity` to
push each save to the Unity editor as well.

## Which one to open

| Project | Open it to see |
|---|---|
| [`showcase`](showcase/README.md) | **The whole catalog**, one view per capability. Start here to look something up. |
| [`hello-button`](hello-button/README.md) | The smallest whole project: one screen, one bound value, one action. Start here to read one. |
| [`inventory-demo`](inventory-demo/README.md) | A real screen built on data: hundreds of virtualized rows, a horizontal strip, a Collapse inside a scroller. |
| [`settings-screen`](settings-screen/README.md) | A real screen built on controls: tabs, toggles, sliders, a dropdown and a text field, all bound. |
| [`unity-playground`](unity-playground/README.md) | A Unity project consuming the SDK locally — the other render target. |

The showcase is exhaustive and the other two zabloo projects are realistic; they are
different questions. "How does `maxLines` behave?" is a showcase question. "How do I lay a
shop out?" is an `inventory-demo` question.

## The showcase's nine views

Pick them from the selector at the top of the preview.

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
the preview's console.

## Related

- [Getting started](../docs/getting-started.md) — build one of these from an empty folder.
- [Component catalog](../docs/components/README.md) — one page per node type.
- [Format reference](../docs/format/envelope.md) — the envelope, and the rules a loader follows.
- [`golden/`](../golden/README.md) — the cross-target corpus. The goldens **measure**; these
  examples are **looked at**. What an example uncovers should end up in the corpus.
