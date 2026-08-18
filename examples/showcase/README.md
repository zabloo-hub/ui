# showcase

**The whole catalog, one view per capability.** Nine views, each one exhaustive about a
single part of the system. This is the project to open when you want to look something
up — "how does `maxLines` behave?" is a showcase question. For a screen that reads like
something a game ships, open [`inventory-demo`](../inventory-demo) or
[`settings-screen`](../settings-screen) instead.

```bash
pnpm --filter showcase-example dev     # http://localhost:5078
pnpm --filter showcase-example build   # dist/zabloo.ir.json — the IR itself
```

Pick the view from the selector at the top of the preview.

## The nine views

| View | What it covers |
|---|---|
| `layout` | The Flexbox subset: `direction`, `justify`, `align`, `gap`, `padding`, sizes, `grow`, `wrap` — plus `clip`, which is paint and not layout. |
| `typography` | The six text style props: `wrap`, `textAlign`, `textAlignY`, `lineHeight`, `maxLines`, `overflow`. |
| `controls` | Button, Checkbox, Switch, RadioGroup, Select, TextInput, Slider on both axes, and the three `group` behaviors. |
| `lists` | `<List>` and `<Grid>` over the `Repeat` primitive: keys, the empty slot, nested item scopes, virtualization. |
| `overlays` | Modal, Toast, Tooltip, the raw `<Overlay>`, the nine anchor placements, flip/clamp, and the popover. |
| `motion` | `transition`, the four easing curves side by side, ProgressBar, Spinner, Badge, animated layout. |
| `media` | `<Image>`: intrinsic size, the three `fit` modes, tint, radius, and the background as a placeholder. |
| `theming` | Tokens, variants, the normative state merge order, and the state matrix. |
| `navigation` | Spatial focus, `autofocus`, focus trapped by a modal, and the focus dragging a scroller. |

## Driving it

Several views carry structure but no content — the document says *how many kinds of node*
there are, the game says *how many of them and what they say*. Each view's header comment
has the exact `zabloo.setData(...)` lines to paste into the preview's console. The most
useful ones:

```js
// lists
zabloo.setData("shop.items", Array.from({ length: 400 }, (_, i) => ({
  id: "item-" + i, name: "Item " + i, price: 20 + i * 3,
})))

// motion
zabloo.setData("demo.progress", 0.9)   // and again with 0.1
zabloo.setData("player.hp", 0.35)
zabloo.setData("inbox.unread", 12)
```

The `navigation` view is the one to drive with the keyboard or a gamepad rather than the
mouse: arrows or d-pad move, Enter/Space/A activate, Escape/B dismiss the top overlay, the
right stick scrolls.

## Layout

```
src/
├── views/          one file per view — layout, typography, controls, lists,
│                   overlays, motion, media, theming, navigation
├── components/     Frame.tsx — Screen/Section/Tile, authoring-time only:
│                   they never reach the IR
├── assets/         banner.png and icons/, inlined into the envelope on export
└── theme.ts        tokens, per-component transitions, variants
```

## Related

- [Component catalog](../../docs/components/README.md) — the normative page for each node type.
- [Format reference](../../docs/format/envelope.md) — the envelope, and the rules a loader follows.
- [`golden/`](../../golden/README.md) — the cross-target corpus. The goldens **measure**;
  this project is **looked at**.
