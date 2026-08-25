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

It loads `examples/hello-button`'s exported envelope from outside the project, so
what you see is always the current build of that example. Pressing **Buy** prints
the named action and writes it to the label at the bottom.

## What renders today, and what does not

G2 is the chassis: the loader, the layout pass, the tessellator and the pointer.
The rest of the catalog arrives capability by capability, and until it does those
nodes degrade rather than disappear — the same forward-tolerance a game gets from
an SDK older than its content:

| Not yet | Lands in |
|---|---|
| Text — glyphs are not rasterized, so labels take no width | G4 (ZAB-137) |
| Images | G5 (ZAB-138) |
| Clipping and scrolling | G6 (ZAB-139) |
| Focus navigation, bindings reading the data channel | G7 (ZAB-140) |
| Transitions | G8 (ZAB-141) |
| Overlays | G9 (ZAB-142) |
| Toggle, Slider, ProgressBar, Spinner behavior | G10 (ZAB-143) |
| Live reload from `zabloo dev --godot` | G14 (ZAB-147) |
