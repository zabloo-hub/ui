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
is always the current build of that example. `SOURCES` at the top of `main.gd`
lists which ones, and **E** swaps between them: `examples/settings-screen` (the F5
catalog — tabs, checkboxes, switches, radios, sliders), `examples/showcase`, whose
`motion` view is what G8 left here and whose `overlays` view is G9's, and
`examples/inventory-demo`, the data-driven list of G12. Inside the showcase,
**1–9** switch view.

**R** reloads, which is the hot-update path (below) — the same swap
`zabloo dev --godot` performs on every save. **V** and **C** drive a
control from the game side rather than by touching it — `set_value` on the volume
slider, `set_open` on the showcase's Collapse — which is how you see that the
by-id operations really are the player's gesture. **I** and **O** push the
inventory's array again, reordered and renumbered.

### Checking G10 by hand

On `settings-screen` (the one it opens on):

- **Drag a slider's thumb** — it follows the finger from the first pixel, with no
  drag threshold, and the value snaps to the grid where one is declared. **Click
  anywhere on the rail** and the thumb jumps there.
- **Watch the log**: `volume-preview` on every move, `settings.volume = …` written
  back on every move, and exactly one `volume-apply` when you let go — none at all
  if you put the thumb back where you found it.
- **Arrows**: with a slider focused, ← and → move the VALUE and ↑ and ↓ move the
  focus off it. `volume-apply` fires when the arrow comes up, not on every press.
- **V** pushes a value from the game: the thumb GLIDES to it, where a drag snaps.
  That is the one place the two differ, and it is deliberate.
- **Checkboxes and switches** take a tap and Enter alike, the radios in the Quality
  row are exclusive by value, and the tabs switch panels.

The other two controls on that screen came with their own tickets: the **language
dropdown** opens its anchored popover (G9) and the **name field** takes text, a
caret and a selection (G11).

### Checking G13 by hand

Plug a controller in — the log says which one it found, and the view starts
reading it. Nothing has to be wired for that: a pad is polled by the SDK, and the
whole point is that everything it produces goes through the handlers the keyboard
already uses, so the two can never drift apart.

On `settings-screen`:

- **D-pad or left stick**: one push is one step of focus, the same spatial step
  the arrows take. **Hold one**: nothing for 400 ms, then a step every 90 ms — a
  second held is 8 steps, not a slide.
- **A** presses the focused control and activates it when you LET GO, exactly
  where Enter does. Unplug the pad mid-press and it cancels instead: pulling a
  cable is not how a player buys something.
- **On a slider**, the directions along its axis move the VALUE and the cross ones
  move the focus off it; `brightness-apply` lands when you release the direction,
  not on every step.
- **On the name field**, ←/→ walk the caret and hand the direction back at the end
  of the text, so you leave the field with the d-pad instead of being trapped in
  it. ↑/↓ always navigate.
- **B** closes the language dropdown, and the modal on the showcase's `overlays`
  view — it is the Escape key. With nothing up it does nothing at all, so a game's
  own pause menu still gets its B.
- **Right stick** scrolls the `ScrollView` the focus is in, at a speed that
  depends on how far you push it. And walking the focus down a long list drags the
  list along, so the focus ring is never off screen.

Remapping, from the game side (`main.gd` does none of this — the defaults are
meant to need nothing):

```gdscript
$Zabloo.set_pad_button("a", JOY_BUTTON_B)      # swap A and B
$Zabloo.set_pad_action("a", &"ui_accept")      # or follow the InputMap
$Zabloo.set_pad_axis("scroll_y", JOY_AXIS_LEFT_Y)
```

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

### Checking G12 by hand

Press **E** until `inventory-demo` is up. Its catalogue is one template over an
array of 400 rows that `main.gd` pushes — the game's data, not the document's.

- **Scroll it.** Only the rows the viewport can show exist; the rest is reserved
  space, which is why the scrollbar is the size it would be if all 400 were there
  and the offset stops exactly at the end.
- **Tick a row's favourite, then press I** to reverse the array. The tick travels
  with its ITEM to the other end of the list instead of staying at the position
  it was on: that is what declaring a `keyPath` buys. The log shows the action's
  item context — its key and its index — because an action fired inside a row
  says which row.
- **Press O** instead: same 400 rows, new ids, so every one of them is a NEW item
  and the ticks stay where they were. Same array, opposite answer, and the only
  difference is whether the keys matched.
- **Focus a row with the arrows and scroll it out of view.** The focus does not
  jump to the top of the screen: nothing wears it while its row is not realized,
  and scrolling back gives it to the same row (ZAB-70).
- **Empty it** — `set_data("shop.items", [])` from the remote inspector — and the
  empty-state slot takes over; push rows again and it steps back out of layout.

### Checking G6 by hand

`inventory-demo` is also the screen with real overflow — a horizontal strip of
buttons, a vertical catalogue and a `Collapse` inside it.

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
swap a platform push and the dev loop both perform — so it is how you check the two halves of the
asset cache by hand:

```sh
# Press E until the showcase is up, replace src/assets/banner.png with another
# picture,
cd ../showcase && pnpm build     # then re-export,
                                 # then press R in the running playground.
```

The new image appears. Textures are keyed by **content hash**, so an image whose
bytes did not change keeps the texture already decoded for it across that reload,
and one the new envelope stopped referencing has its texture dropped.

## Checking G14 by hand — the dev loop

Doing all of the above ON SAVE is `zabloo dev --godot`. The playground already has
the addon enabled, so its `ZablooDevMode` autoload is listening the moment you
press Play — the log says so.

```sh
cd ../showcase && pnpm dev:godot   # then press Play here
```

- **Edit a `.tsx`** — change a label in `src/views/media.tsx` — and the view swaps
  without touching the game. The gold in the corner does **not** reset: what the
  game pushed with `set_data` lives on the document, so it outlives the content it
  was feeding. That is production hot-update behavior, not a dev convenience.
- **Watch both logs.** The CLI prints `pushed to Godot … ✔ (1 view)` and Godot
  prints `reloaded 1 view(s), no new assets`. Save again: still no new assets,
  however many times you do it — the tree travels, the bytes do not.
- **Replace `src/assets/banner.png`** with another picture. Now Godot prints
  `1 asset(s) fetched`, exactly once, and the saves after it are back to `no new
  assets`. N reloads, one transfer: the point of the whole transport.
- **Quit the game and keep saving.** The CLI says the dev mode is not reachable
  **once** and then goes quiet; press Play again and the next save says `— back`.
  A game that is not running is the normal state of an afternoon spent in the
  browser.
- **Run a second copy of the playground.** It finds the port taken and says so
  instead of silently listening to nothing.

Note what is NOT here: nothing in `main.gd` mentions the dev loop. Enabling the
addon is the whole installation.

## What renders today, and what does not

G2 is the chassis — the loader, the layout pass, the tessellator and the pointer —
G4 added the text engine, so labels measure, wrap and paint their glyphs, G5 added
images, G6 clipping and scrolling, G7 states, spatial focus and the data channel,
G8 the transition engine, G9 the overlay layer, G10 the four controls with a
value, G11 the `TextInput`, G12 data-driven lists — a `Repeat` expanded from a
bound array, virtualized inside a scroller, with per-item state that travels with
its `key` — and G13 the gamepad.

**Every node type of the catalog renders**, and every case of the golden corpus
reproduces its recorded metrics byte for byte. G14 closed the last thing that was
not a node — live reload from `zabloo dev --godot`.
