# godot-playground

The smallest Godot project that renders a zabloo envelope, used to check the SDK
against a real engine — the half of the work the golden corpus deliberately does
not cover (the corpus runs the core on a bare CPU, with no Godot and no GPU).

## Run it

```sh
# 1. Build the extension (first run also builds godot-cpp — a few minutes).
cd ../../sdk/godot && scons

# 2. Copy the addon in, the way a game consumes a release.
scons install

# 3. Open this folder in Godot 4.4 or newer and press Play.
```

It loads an example's exported envelope from outside the project, so what you see
is always the current build of that example. Which one is whatever the capability
that landed last needs to be seen doing its job — `ENVELOPE` and `VIEW` at the top
of `main.gd` are the two lines to move. Today they point at `examples/showcase`'s
`overlays` view, which is what G9 is about, and there **1–9** switch view.

**R** reloads, which is the hot-update path (below).

### Checking G9 by hand

The `overlays` view is the whole layer on one screen. Nothing here is seeded by
the game: every switch writes the flag its overlay's `visible` reads, which is
the point — `visible` is the single mechanism, and a dismiss writes `false` back
through the same binding.

- **Flip "Modal"** — the screen dims, the switches underneath stop answering the
  pointer, and the focus jumps inside the dialog. **Escape** closes it and the
  switch goes back down **by itself**: that is the SDK writing through the
  binding, not the game reacting. So does a click on the dim area, and so does
  "Cancel". Closing gives the focus back to the switch that opened it.
- **Open the modal, then "Details"** — a modal declared INSIDE another one, and
  while it is up it owns the input. Closing it returns the focus to the outer
  dialog, not to the switch: the outermost one that leaves owns the restore.
- **Flip "Toast"** — it closes itself after three seconds, on the core's own
  injected clock, and its switch goes down with it.
- **Hover the nine placement buttons** — `top-left` means ABOVE, flush with the
  left edge; `center` sits ON the button. **Tab away from the mouse and use the
  arrows**: the same bubbles follow the focus ring, because `trigger: "hover"` is
  hover OR focus and the equivalent on a pad is the focus.
- **Narrow the window** until the right-hand bubble of "Flip and clamp" jumps to
  the other side of its button. Flip first, then clamp, and never both on one
  axis.
- **Press "Actions"** — the popover. Its own `onClick` still reaches the log, the
  same press closes it again, and Escape or a click outside closes it too. Note
  what does NOT happen: no `data_changed` for the menu, because a popover's open
  state is the SDK's and never the game's data.
- **Press 1 for `controls`** and open the `<Select>` there: it opens ON the
  option already chosen, scrolled to it, and choosing closes the menu — including
  when you re-pick the one already selected.

### Checking G6 by hand

Point `ENVELOPE` at `../inventory-demo/dist/zabloo.ir.json` and `VIEW` at
`inventory`: it is the screen with real overflow — a horizontal strip of buttons,
a vertical catalogue and a `Collapse` inside it.

- **Wheel** over the catalogue scrolls it, and stops dead at both ends.
- **Drag** it with the mouse held down; drag the category strip sideways too,
  grabbing a GAP between two buttons — a press on a button takes the pointer
  itself, which is the hole ZAB-9 left open on purpose. The wheel does not move a
  horizontal-only scroller either, which is the same kind of deliberate (the axes
  stay 1:1 with the reference, decision 2026-09-01).
- **Click a category button** and its action reaches the log: a press takes the
  pointer before any drag can, so a list of buttons is still a list of buttons.
- **Rounded corners** — the catalogue's content is cut by the panel's radius, not
  by its bounding box.

## Watching a hot-update keep its textures

`R` goes through `load_file` → `load_envelope` → the core's one loader — the same
swap a platform push performs — so it is how you check the two halves of the
asset cache by hand:

```sh
# Point ENVELOPE at ../showcase, replace src/assets/banner.png with another
# picture,
cd ../showcase && pnpm build     # then re-export,
                                 # then press R in the running playground.
```

The new image appears. Textures are keyed by **content hash**, so an image whose
bytes did not change keeps the texture already decoded for it across that reload,
and one the new envelope stopped referencing has its texture dropped. Doing all
that ON SAVE is the dev loop, `zabloo dev --godot`, which is G14 (ZAB-147).

## What renders today, and what does not

G2 is the chassis — the loader, the layout pass, the tessellator and the pointer —
G4 added the text engine, so labels measure, wrap and paint their glyphs, G5 added
images, G6 clipping and scrolling, G7 states, spatial focus and the data channel,
G8 the transition engine and G9 the
overlay layer. The rest of the catalog arrives capability by
capability, and until it does those nodes degrade rather than disappear — the same
forward-tolerance a game gets from an SDK older than its content:

| Not yet | Lands in |
|---|---|
| The Slider's value-driven slots | G10 (ZAB-143) |
| TextInput | G11 (ZAB-144) |
| Data-driven lists (`Repeat`) | G12 (ZAB-145) |
| Gamepad | G13 (ZAB-146) |
| Live reload from `zabloo dev --godot` | G14 (ZAB-147) |
