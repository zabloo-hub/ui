# inventory-demo

**A real screen built on data.** A guild shop with genuine overflow: hundreds of
virtualized rows, a horizontal category strip, and a `<Collapse>` nested inside the
scroller. The reference for "how do I lay a shop out?" — the exhaustive per-prop tour of
each control is [`showcase`](../showcase) next door.

```bash
pnpm --filter inventory-demo-example dev     # http://localhost:5078
pnpm --filter inventory-demo-example build   # dist/zabloo.ir.json — the IR itself
```

## What it demonstrates

The catalogue is **one item template bound to `shop.items`** — the game pushes the array,
and data decides how many nodes there are, not just what they say.

- **Hundreds of items scroll fluidly.** The renderer realizes only the rows the viewport
  can see (plus a buffer) and reserves the space of the rest, so the work per frame does
  not grow with the array.
- **Identity travels.** With `keyPath="id"`, reordering or splicing the array moves each
  row's state — its focus ring, its favourite Toggle — with the *item* instead of leaving
  it pinned to a position.
- **Writes go back through the same channel.** The favourite Toggle inside a row writes
  `shop.items.<n>.fav`; there is no per-component API, and the preview logs it.
- **Actions say *which* one.** Every row fires the same `buy`, and the payload carries the
  item (`shop.items.<n>`, its key and its index). No id per row — an `id` inside a
  template would be worn by every instance of it.
- **The empty state is a slot** (`empty`), not an expression: it shows before any data
  arrives, or when the array is empty.
- **The scroller's own rules hold around the list.** The category strip scrolls on the
  other axis with no indicator, the `<Collapse>` inside the scroller re-clamps the offset
  when it closes, and nothing paints outside the panel.

## Driving it

Paste into the browser console (or into the bindings panel's JSON editor):

```js
zabloo.setData("shop.items", Array.from({ length: 400 }, (_, i) => ({
  id: "item-" + i, tag: "IT", name: "Item " + i,
  detail: "Damage " + (i % 20) + " · Weight " + (i % 9), price: 20 + i * 3,
})))
zabloo.setData("player.gold", 4200)
```

Then: scroll fast and watch nothing smear (the per-row transitions are there precisely so
a recycled row would be *visible* as a crossfade); reorder `shop.items` and watch the
focus ring follow its item; tick a favourite and read the write in the log.

The category strip takes a **horizontal** gesture — a trackpad swipe, or a drag started
between chips. A plain wheel is `deltaY`, which that axis ignores, and a drag started *on*
a chip presses the Button instead of scrolling.

## Layout

```
src/
├── views/inventory.tsx   one file, one view (the filename is the view ID)
└── theme.ts              tokens, per-component transitions, variants
```

## Related

- [`ScrollView`](../../docs/components/scrollview.md) and [`Repeat`](../../docs/components/repeat.md) — the normative pages.
- [Bindings & actions](../../docs/format/bindings.md) — how a write finds its path and an action its payload.
- [`examples/README.md`](../README.md) — which example to open for what.
