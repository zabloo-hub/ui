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

It loads `examples/showcase`'s exported envelope from outside the project, so
what you see is always the current build of that example. **R** reloads it and
**1–9** switch view; it opens on `media`, which is the one G5 (images) is about.

## Watching a hot-update keep its textures

`R` goes through `load_file` → `load_envelope` → the core's one loader — the same
swap a platform push performs — so it is how you check the two halves of the
asset cache by hand:

```sh
# Replace examples/showcase/src/assets/banner.png with a different picture,
cd ../showcase && pnpm build     # then re-export,
                                 # then press R in the running playground.
```

The new image appears. Textures are keyed by **content hash**, so an image whose
bytes did not change keeps the texture already decoded for it across that reload,
and one the new envelope stopped referencing has its texture dropped. Doing all
that ON SAVE is the dev loop, `zabloo dev --godot`, which is G14 (ZAB-147).

## What renders today, and what does not

G2 is the chassis — the loader, the layout pass, the tessellator and the pointer —
G4 added the text engine, so labels measure, wrap and paint their glyphs, and G5
added images. The rest of the catalog arrives capability by capability, and until
it does those nodes degrade rather than disappear — the same forward-tolerance a
game gets from an SDK older than its content:

| Not yet | Lands in |
|---|---|
| Clipping and scrolling | G6 (ZAB-139) |
| Focus navigation, bindings reading the data channel | G7 (ZAB-140) |
| Transitions | G8 (ZAB-141) |
| Overlays | G9 (ZAB-142) |
| Toggle, Slider, ProgressBar, Spinner behavior | G10 (ZAB-143) |
| Live reload from `zabloo dev --godot` | G14 (ZAB-147) |
