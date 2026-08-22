# @zabloo/renderer-web

## 0.2.0

### Minor Changes

- 85a1a3a: Implement `disabled`, the last of the seven `StateName`s with no implementation behind it.
  It is a bindable prop on `NodeBase` rather than a derived state, because it **inherits**: a
  node's effective value is its own OR any ancestor's, so disabling half a form is one prop on
  the section. An `Overlay` restarts the chain — a modal declared inside a dimmed panel stays
  operable.

  A disabled node leaves the interaction model entirely: not focusable, no pointer, no
  directional navigation. A press falls **through** it, anything it was holding is released, and
  an in-flight Slider gesture is cancelled without committing. A disabled section stays readable
  and its ScrollView still scrolls, and the host data channel is never blocked.

- 85a1a3a: `onChange` on `ContainerNode`, meaningful under `group: "exclusive-check"`: the group owns the
  value, so the group is what answers "the selection moved". `<Select onChange>` was typed and
  documented but never reached the IR, and the renderer only ever fired from the option node —
  there was no typed way to get a named action out of a `<Select>`.

  It carries no payload beyond the name and ZAB-29's `ActionContext` (the chosen option's); the
  value already comes back through the data channel. It fires on the write edge, right after the
  new value lands in the bound path, and never when re-picking the option already selected.

- 85a1a3a: Close seven gaps and asymmetries in the renderer's public surface before the freeze — things
  the renderer knows and would not let you read, or exposed two different ways.

  - **`onDiagnostic` in `MountOptions`.** `@zabloo/format` produces _structured_ diagnostics —
    stable code, path into the envelope — and `loadEnvelope` dumped them to `console.warn`, where
    that structure died: a dev server overlay, the preview and the future editor cannot scrape a
    console. The sink receives warns and fatals, on both `mount` and `reload`, and the fatals
    arrive before the throw. Without a sink the console lines are exactly what they always were.
  - The preview stops depending on the console: a repaired `warn` takes the fading log line, a
    `fatal` takes the overlay and the red dot.
  - **`handle.viewIds` is a getter.** It was `Object.keys()` evaluated once when the handle was
    built, so after a `reload` the caller still listed the views from before the save — a save
    that added a view left it invisible until a manual page reload.
  - **`findNode` is exported**: `serializeSnapshot` was there, but reading a `ViewSnapshot` needs
    the single node.

- 85a1a3a: The six hot paths ZAB-55 left out, plus the hole in its own budgets.

  - **A blinking caret no longer runs the full pipeline at 60fps.** A focused `TextInput` marked
    the view `animating`, so the whole thing ran sync → resolve → measure → arrange → tessellate →
    draw to blink a 2px rectangle. But `caretVisible` is a closed form of the time since the last
    edit: neither the tree, its values nor its boxes depend on it. The frame is now requested on
    the flip and is a **repaint** — everything before tessellation is skipped. Leaving a field
    focused goes from 0.157 ms and 46.4 KB per 16 ms tick to 0.003 ms and 1.2 KB.
  - `effectiveStyle` was recomputed three times per node per frame; it is cached on the node
    stamped with the frame counter.
  - Five full tree walks per frame before layout are gone.

  `FrameStats` gains `resolved`, `textLayouts`, `bufferGrowths` and `repaintOnly`, and the
  performance budgets are asserted against realistic scenes at realistic sizes rather than
  fifteen 480×320 ones on the first frame after mount.

- 85a1a3a: Release ops and the CLI surface a studio needs in its own CI.

  **`zabloo validate [file]`** runs the loading contract — the same one every SDK
  applies — against an envelope on disk and answers in exit-code terms: `0` when it
  loads, `1` on a fatal, `--strict` to fail on repaired warnings too, `--json` for a
  step that wants the diagnostic's path rather than a rendered line. Until now the
  only way to check a committed envelope was to write a script against
  `@zabloo/format` first.

  **`zabloo preview <envelope.json>`** serves the web preview for an envelope with no
  project around it — a build artifact, a colleague's attachment — and reloads when
  the file changes. **`zabloo export --out <file>`** writes one project's envelope
  wherever a CI matrix row needs it, and **`zabloo dev --open`** opens the browser.

  **The preview grew the three things it was missing.** _Viewport presets_
  (1920×1080, 1280×720, custom, plus a DPR selector): the canvas was `flex: 1` and
  took the window, so a UI authored for 1080p could not be looked at in 720p. Under a
  preset the canvas keeps its declared pixel size — which is what the renderer lays
  out against — and only a CSS transform shrinks it to fit. A _stats badge_ for what
  the last painted frame cost, which `stats()` would only tell you if you typed
  `zabloo.stats()` into a console you were not looking at. And an _SSE keepalive_, so
  live reload survives a proxy that drops idle connections.

  `@zabloo/renderer-web` gains the two `MountOptions` those need, both additive:
  `dpr`, which overrides the page's device pixel ratio everywhere the renderer turns
  logical pixels into device ones, and `onFrame`, which fires once per frame actually
  painted with what it cost. Only the renderer knows when it drew — it paints on
  demand — so only the renderer can report a frame rate.

  **The preview now refuses requests addressed to a host that is not ours** (403,
  with `--allow-host <host>` for a Codespace or a tunnel). Binding to loopback was
  never the defence it looks like: a page on an attacker's domain whose DNS answers
  127.0.0.1 reaches the preview through the developer's own browser and reads
  whatever envelope was being worked on.

  `create-zabloo-app` stops hardcoding the range it scaffolds. It was the literal
  `^0.1.0`, guarded by nothing — after the first version bump every new user would
  have been pinned to `^0.1.0` in silence, and the external smoke test cannot see it
  because it rewrites those dependencies to local tarballs before installing.

### Patch Changes

- 7668939: Pointer events are mapped through the scale the canvas is drawn at, so the controls answer
  where they are painted.

  A host that keeps the canvas at its logical size and shrinks it with a `transform` — which is
  what the dev preview does under every fixed viewport — leaves `getBoundingClientRect` reporting
  one box and `clientWidth` another. `eventPoint` measured against the visual one and handed the
  point to a tree laid out in the other, so at 76% zoom every control fired about 120px away from
  itself. The point (and the wheel's deltas, which are screen pixels too) now takes the
  `clientWidth / rect.width` factor, read from the rect that was already cached for it.

  A resize that did not change the backing store no longer reassigns `canvas.width`, which threw
  the drawing buffer away for nothing: it is how a host announces that the canvas was rescaled
  rather than resized.

- 731a375: The keys of the page around the canvas are left to the page: a focused control of the host's
  own UI keeps the Enter, the Space and the arrows the browser owes it.

  The renderer listens for `keydown` on the window, so it hears every key the page gets, and it
  answered them all with `preventDefault()` after asking only which of the mounted views owned
  input. With any chrome around the canvas — a toolbar, a panel, a console — that meant no button
  of the host's could be activated from the keyboard at all: the key arrived already prevented and
  the browser never turned it into a click. The view now reads a key only when the page's focus is
  on its canvas, on the hidden field a focused `TextInput` types through, or on nothing at all,
  and it asks before preventing anything rather than after.

  The canvas is made focusable (`tabindex="0"`, unless the host set its own), so the focus can be
  tabbed into the game and out again; pressing it takes the page's focus as well as the input, and
  focusing it claims the input, so the two can never point at different views. A disposed view
  releases the focus it was holding.

- 85a1a3a: Give every package a README and complete npm metadata (`repository` with its monorepo
  `directory`, `homepage`, `bugs`, `keywords`, `engines.node`, explicit
  `publishConfig.access`), and ship `LICENSE` inside each tarball instead of only at the
  repo root. `@zabloo/cli` and `create-zabloo-app` close their `exports` to
  `./package.json`: they are executables, not libraries.

  Fix the import that made `@zabloo/react` unimportable from Node — `react-reconciler/constants`
  has no extension and that package declares no `exports`, so the ESM resolver refused it
  (`ERR_MODULE_NOT_FOUND`) for every real consumer.

- 85a1a3a: Settle the whole subtree of a recycled `Repeat` instance, not just its bound nodes.
  `applyBindings(node, true)` promised "this starts ON this data, so there is nothing to animate
  from" and did not keep it: it settled the value but left `node.anim` alone, so the next resolve
  pass read the previous row's value from there, saw a different target and re-targeted — the
  settle was undone and the row animated.

  The walk covers the subtree rather than the bound set because no `style` value is bindable in
  v1: per-item variation arrives through state flags, and the heaviest case is an **inherited**
  `disabled` whose label reads no data at all. A change to the item's own data still animates —
  the settle is for the change of identity.

- 85a1a3a: Harden the renderer against the browser's GPU failures.

  - **WebGL context loss is handled.** A backgrounded mobile tab, a GPU reset or a driver hiccup
    used to leave the canvas blank forever, every GL call a silent no-op. `GLRenderer` now listens
    for `webglcontextlost` (with `preventDefault`, without which the restore never fires) and
    `webglcontextrestored`, rebuilding program, buffers, attributes and the white texture — the
    context comes back empty. Dropping the texture map on loss is what makes the next frame
    re-upload atlases and images on its own.
  - **16-bit index space overflow.** Past 65,536 vertices in one (clip group × texture) batch the
    index wrapped mod 65536 and the geometry scrambled with no warning — roughly a long
    unvirtualized list. Indices are `Uint32Array` and the draw is `UNSIGNED_INT` (core in WebGL2),
    so the ceiling moves to 4G vertices and no guard is needed.

- 85a1a3a: Bound the text engine's two unbounded inputs and two per-frame hot paths.

  - `fontSize` is clamped to 1..512 where style resolves, and the ceiling is normative.
  - Rasterization degrades to a blank glyph with one warning per atlas instead of letting
    `zb_malloc`'s throw escape the measure pass into rAF.
  - `reserve()` checks width too: a glyph wider than the atlas used to be placed anyway, off the
    edge, with UVs above 1.
  - `breakWord` measures each glyph once instead of re-measuring the rest of the line per line
    (2.1 lookups per glyph against ~10⁹ for a 50k token), and `maxLines` stops the work as soon as
    it is satisfied. Kerning is memoized per pair and atlas, `layoutText` per node.

  Break points and widths are unchanged.

- 85a1a3a: Three input and focus holes, each with its normative rule.

  - `pointercancel` was not listened for, so a cancelled pointer left the gesture in flight
    forever — a button frozen pressed, a slider still following the next move. Every gesture now
    terminates and none concludes, except the Slider, which settles: its value is already on
    screen and written to its binding.
  - The focus of a virtualized row died when it left the window and the next frame handed it to
    the view's autofocus — a jump across the screen caused by the wheel, a drag or the right
    stick. It is now a **logical** focus, remembered as the item it sat on, and the row recovers
    it when it is realized again.
  - Keyboard and gamepad hung off `globalThis` while the pointer was scoped to the canvas, so two
    mounted views each moved their own focus with the same arrow and consumed the same pad. There
    is an owner now: the first mounted, and whichever the player touches takes it.

- 85a1a3a: Six surgical correctness fixes; none of them moves a rect in the golden corpus.

  - `arrange` returned before the `isScrollView` block when nothing was left in flow, so a
    ScrollView whose children all turned `visible: false` kept the last populated frame's
    `scrollMax` and went on scrolling into nothing.
  - `crossOf` read the raw `layout.height` instead of the resolved one — the single place in the
    pass that did — so an unresolvable token took the "declared" branch and gave the slot its
    content's height instead of the whole rail.
  - `arrangeOverlay` handed the same `viewRect` object to every anchored overlay and the root.
  - `checkRange` returned unless _both_ bounds were numbers, letting `{type: "Slider", min: 5}`
    through with an inverted range against the default `max` of 1.
  - The Slider branch of `measure` measured children outside layout, whose `resolved` is whatever
    the last frame that painted them left behind.

- a54c35d: JSDoc corrections on the public surface. `ToggleControlProps.onChange` said it fired
  "after every change" without the grouped case: inside a `<RadioGroup>` or `<Select>` it
  fires only for the option that TAKES the selection, never for the one that loses it. The
  remaining Spanish comments in `export.ts` and the perf scenes are now English.
- Updated dependencies [85a1a3a]
- Updated dependencies [85a1a3a]
- Updated dependencies [85a1a3a]
- Updated dependencies [85a1a3a]
- Updated dependencies [85a1a3a]
  - @zabloo/format@0.2.0
