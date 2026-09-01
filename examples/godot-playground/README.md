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
`motion` view, which is what G8 is about, and there **1–9** switch view.

**R** reloads, which is the hot-update path (below).

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
and G8 the transition engine. The rest of the catalog arrives capability by
capability, and until it does those nodes degrade rather than disappear — the same
forward-tolerance a game gets from an SDK older than its content:

| Not yet | Lands in |
|---|---|
| Overlays | G9 (ZAB-142) |
| The Slider's value-driven slots | G10 (ZAB-143) |
| TextInput | G11 (ZAB-144) |
| Data-driven lists (`Repeat`) | G12 (ZAB-145) |
| Gamepad | G13 (ZAB-146) |
| Live reload from `zabloo dev --godot` | G14 (ZAB-147) |
