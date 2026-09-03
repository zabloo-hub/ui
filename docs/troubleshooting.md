# Troubleshooting

Three places tell you something is wrong, and they are not interchangeable:

| Where | What it is |
|---|---|
| **The export throws** | An authoring error. `@zabloo/react` refuses to emit a tree it knows is broken — the whole list is [below](#authoring-errors). |
| **A `⚠` line, or `onDiagnostic`** | The [loading contract](format/loading.md) repaired something. The envelope loaded without the broken part. |
| **Nothing at all** | It rendered, and it is not what you meant. The [sharp edges](#it-renders-but-not-like-that) come first on this page for that reason. |

## It renders, but not like that

### `<Grid>` needs numeric `gap`, `padding` and `width`

The grid's geometry is arithmetic, not a percentage: v1 has no fractional dims, so the cell
width is solved **at authoring time** from `columns` and either `itemWidth` or
`layout.width`. A token only resolves inside the SDK — too late for that sum.

```tsx
<Grid items="inv.slots" columns={4} itemWidth={72} layout={{ gap: 8, padding: 12 }} />  // ✔
<Grid items="inv.slots" columns={4} itemWidth={72} layout={{ gap: "{space.2}" }} />     // ✘ throws
```

`<List>` has no such restriction — it is an ordinary flex container and takes tokens
everywhere.

### A `<ScrollView>` that does not scroll

It is a normal flex container that hugs its content unless you size it. Giving it neither a
size nor a growing parent leaves nothing to scroll.

Inside a flex parent, `grow: 1` alone is not enough: a child's base size is its content, so
it grows *from* the whole content and the viewport is as tall as what is in it. Zero the
base on the scrollable axis:

```tsx
<ScrollView layout={{ height: 0, grow: 1 }}>…</ScrollView>   // in a column
<ScrollView layout={{ width: 0, grow: 1 }}>…</ScrollView>    // in a row
```

Or give it a fixed size (`layout={{ height: 340 }}`). See
[Layout](format/layout.md) for why.

### An `id` inside a `<List>` template addresses the wrong row

Every instance of the template wears that `id`, and the lookup keeps the **last one
realized**. So `setChecked("row-toggle", true)` reaches *one* of them, not the one you meant.

Addressing a particular row by id is not something v1 does. The other direction works: an
action fired from inside an item comes back with its
[`ActionContext`](format/host-channel.md#the-callbacks) — the item's path, key and index.

### An `<Overlay>` ignores `layout.width` / `height`

Its rect **is** the view's. Size the child instead, and use the overlay's `justify`/`align`/
`padding` to place it. Its own `style.background` — with alpha — is the backdrop.

### `disabled` switched off more than you expected

It inherits: `disabled` on a `<Column>` takes the whole subtree out of the interaction
model, labels included. That is the point (one prop disables a form), but it means a
`disabled` high in the tree is not a local decision.

### A `<Collapse>` needs two children

`children[0]` is the header, always visible and toggling on tap; `children[1..]` is the
content. One child is refused rather than rendered as a header with nothing to open.

### An unknown `variant` stops the export

By design — it is authoring time, and a typo in a variant name is a silent style loss
otherwise. The message lists the variants the theme *does* define for that component.
Remember the key is the [primitive](theming.md#variants-are-keyed-by-primitive):
`<Checkbox variant="row">` reads `variants.Toggle.row`.

### Text that is not in a `<Text>`

Raw text is only legal inside `<Text>`. Everywhere else it throws: there is no anonymous
text node in the IR, and wrapping it silently would invent a node with a style nobody
declared.

### A value changes but does not animate

Both endpoints must resolve. An `undefined` (auto) endpoint has nothing to tween from, so
the change snaps — most often a size or a color that was never declared in the base style.
Mounting and reloading snap too. See [Motion](format/motion.md#endpoints).

## Authoring errors

Every message `@zabloo/react` throws, and what it wants. The export prints them as
`zabloo export: <message>` and exits `1`; under `zabloo dev` the last good render stays on
screen and the message goes to the [**Problems** tab](#the-dev-preview).

### The view

| Message | What to do |
|---|---|
| `A view must emit exactly one root primitive, got N. Wrap siblings in a <Container>.` | A view is one tree. Wrap the siblings — `<Column>` is usually what you meant. |
| `A view's root must be a primitive, not raw text — wrap it in <Text>.` | The root has to be a node. |
| `<X> is not a zabloo primitive. …` | A lowercase/unknown intrinsic reached the reconciler (`<div>`, a typo). The message lists the v1 vocabulary. |
| `<file>.tsx: a view must default-export a component` | The file in `src/views/` has no default export, or it is not a function. |
| `Duplicate view id "x" (from f.tsx)` | Two files resolve to the same id — check `export const id`. |

### Text and children

| Message | What to do |
|---|---|
| ``<Text> children must be plain text (or use the `bind` prop).`` | A `<Text>` holds a string or a binding, never nodes. |
| `Raw text "…" must be wrapped in <Text> (found inside <X>).` | Wrap it. |
| `<TextInput> takes no children — it is a leaf, like <Text>.` | Use `placeholder`, and put a label beside it. |
| `<Image> takes no children — it is a leaf, like <Text>.` | Overlay content on an image with a `<Container>` around both. |

### Positional slots

Five node types read their children [by position](components/README.md#positional-slots), so
a half-built one fails here rather than rendering a control that never changes shape.

| Message | What to do |
|---|---|
| `<Collapse> needs at least a header (first child) and one content child.` | Give it both. |
| `A Toggle needs both indicator slots: children[0] (checked) and children[1] (unchecked).` | Use `<Checkbox>`/`<Switch>`/`<Radio>`/`<Option>` — they build the slots. |
| `A Slider needs exactly two slots: children[0] (fill), children[1] (thumb).` | Use `<Slider>`, which emits both. |
| `<ProgressBar> takes exactly one child: the fill.` | Use `<ProgressBar>`; style the fill with its `fill` prop. |
| `<List>/<Grid> need an item template as their children.` | `children[0]` is the template, `children[1..]` the empty state. |

### Controls

| Message | What to do |
|---|---|
| `<Slider value> must be a number or a { bind } binding.` | Not an arbitrary object. |
| `<Slider> needs max > min (got min=…, max=…).` | An empty or inverted range has no position to map a value to. |
| `<TextInput value> is a string (or a binding to one).` | A number is not a text buffer. |
| `<TextInput value> must be a string or a { bind } binding.` | Same, for a non-binding object. |
| `<TextInput maxLength={N}> must be a positive number of characters (omit it for an unbounded field).` | The renderer ignores a non-positive cap, which would turn a typo into "no limit". |
| `A <Radio> value is static — bind the selection on the <RadioGroup> instead.` | The option's `value` is its identity; the *selection* is the group's binding. |
| `<ProgressBar value> is a number in 0..1 (or a binding to one).` | It is a fraction, not a percentage and not a label. |
| `<Spinner> needs at least one child: the beads that pulse.` | `<Spinner>` builds them from `dots` unless you pass your own. |
| `<Spinner min={…}> is the opacity multiplier at the wave's dimmest, between 0 and 1 (omit it for the default 0.25).` | `min={25}` is the usual mistake — it is a multiplier, not a percent. |
| ``<Image> needs a `src` path relative to src/assets/, e.g. "icons/coin.png".`` | Assets are authoring input; the path cannot be a binding. |

### Overlays

| Message | What to do |
|---|---|
| `<Overlay autoCloseMs={N}> must be a positive number of milliseconds (…)` | Omit it to keep the overlay up until something closes it. |
| `<Overlay z={…}> must be a finite number: …` | A `NaN` — the shape of `z={Number(props.layer)}` on a missing prop — would silently sort as 0. |
| ``An anchored overlay needs the `id` of the node it hangs from …`` | And that node needs the same `id`. |
| `<Overlay anchor.offset={…}> is the gap in px between the anchor's edge and the content: zero or more (omit it for the default 8).` | A token string is fine (it is a `Dim`); a negative number would place the content *inside* its anchor. |

### Lists and grids

| Message | What to do |
|---|---|
| ``<List>/<Grid> need an `items` data path, e.g. items="shop.items". …`` | The array lives in the game's data, never in the document. |
| `A <List> template is a single node — wrap the items' contents in a <Row> or <Column>.` | `children[0]` *is* the template; a fragment is refused for the same reason. |
| `<Grid columns={N}> must be an integer >= 1.` | The geometry is solved from it. |
| `<Grid itemWidth={N}> must be a positive number of px.` | Give `itemWidth` **or** a numeric `layout.width`. |
| `<Grid> needs its geometry: pass `itemWidth`, or a numeric `layout.width` to divide.` | Neither was usable. |
| `<Grid> resolves its cell width at authoring time, so layout.<prop> must be a number of px here (got …).` | `gap`, `padding` and `width` cannot be tokens on a `<Grid>`. |
| `<Grid columns={N}> does not fit in Wpx with gap G and padding P.` | The cells come out at zero or less. Widen it, or drop a column. |

### Tabs, Select and the theme

| Message | What to do |
|---|---|
| `<Tab> must be a direct child of <Tabs>.` | `<Tab>` is a marker: `<Tabs>` reads its props and emits the button/panel pair. It never renders itself. |
| `<Tabs> children must all be <Tab> elements.` | Including a `.map()` that returns something else. |
| `<Tabs> needs at least one <Tab>.` | — |
| `<Tabs selected={N}> is out of range — there are N tabs.` | `selected` is a 0-based index into the bar. |
| ``<Select> needs an `id`: the dropdown is anchored to the button by it …`` | An anchor is the one relation in v1 that addresses another node by name. |
| `Unknown Button variant "primary" (theme defines: …)` | The variant is missing for that **primitive** — see [theming](theming.md#variants-are-keyed-by-primitive). |
| `Unknown Button variant "primary" — no variants defined in the theme` | The theme has no variants for that primitive at all. Check `src/theme.ts` is exporting `variants`. |

## Loading diagnostics

These come from the envelope, not from your JSX, and they are what `zabloo export` prints as
`⚠` and what a host receives on
[`onDiagnostic`](format/host-channel.md#the-callbacks).

- A **`warn`** was repaired: a dangling token, an unknown asset or anchor, a duplicate id, a
  malformed node, a prop of the wrong type. The envelope loaded without the broken part.
- A **`fatal`** means nothing loaded — invalid JSON, no usable views, an incompatible major
  version. It fails the export, and at runtime it makes `mount` throw while `reload`
  discards the payload and keeps the view on screen.
- **Unknown props and unknown node types are silent.** Forward-tolerance is a feature.

Each one carries a stable `code` and a `path` into the envelope
(`views["hud"].children[2].text`). The full code table is in
[Loading](format/loading.md#diagnostics).

## At runtime, nothing happens

| Symptom | Likely cause |
|---|---|
| `setChecked` / `setOpen` / `setValue` returns `false` | No node of that type carries that id — a typo, or the node is out of the tree. Nothing was applied; the web renderer and Godot both log the miss. |
| Bound text stays empty | The path is not the one being written. Writes are cached and replayed, so pushing *before* mount is fine — a path mismatch is not. |
| `onDataChanged` never fires | It fires only when the **UI** writes: a control with a read/write binding. It deliberately never echoes `SetData`. |
| An action does not fire | The node (or an ancestor) is `disabled`, or a modal `Overlay` above it is capturing input. |
| A hot-update did nothing | `reload` never throws: a refused payload is reported through `onDiagnostic` and discarded. Check the diagnostics. |
| The view picker lists old views | `viewIds` is read from the envelope loaded **now** — re-read it after every `reload`. |

## In Godot

### `ZablooView` is not in the Add Node dialog

The addon is not enabled. Unzipping `addons/zabloo/` into the project is only half of it —
**Project → Project Settings → Plugins → Zabloo UI** is what loads the extension and
registers the node. If it is enabled and the node still is not there, the editor could not
load the library: the output panel says which file it looked for, and the answer is almost
always that `addons/zabloo/bin/` has no binary for this platform (a release zip carries all
of them; a `scons` build carries only the one you built).

### Nothing renders and the output says `[zabloo] no envelope at res://…`

`Envelope Path` points at a file that is not in the project. The exported
`dist/zabloo.ir.json` has to be *copied into* the Godot project — `res://` cannot reach
outside it. A path that exists but holds a payload the loader refuses is a different
symptom: the node stays blank and says why through
[the diagnostics](format/loading.md#in-godot), and `load_file` returned `false`.

### The view renders, but ignores the `Control` I put it in

That is deliberate. Godot's own layout stops at the `ZablooView`'s rect: anchors and
`Container` nodes are a second layout system, and letting it reach inside would mean the
same envelope laying out differently here than on every other target. Size and place the
`ZablooView` itself with Godot; everything inside it is the core's.

### `zabloo dev --godot` says nothing arrives

Four things, in the order worth checking:

| Check | Why |
|---|---|
| The game is **running** | Godot's `Run` launches a separate process, and that process is the receiver — not the editor. A project that is not running needs no push: `load_file` reads the last export off disk when it starts. |
| It is a **debug** build | The receiver listens on loopback in debug builds only. A dev channel a shipped game could open is a dev channel a player's machine could be talked to through. |
| The plugin is enabled | It is what installs the `ZablooDevMode` autoload. The game wires nothing else. |
| Nothing else holds the port | `5079` by default. A second instance of the game finds it taken and says so; `zabloo/dev_mode/port` in the project settings moves one end, `--godot-port` the other. |

If nothing is listening the export still succeeds, and the CLI says so **once** rather than
on every save.

### A web export loads nothing

A GDExtension on the web needs the `dlink` export templates — **Web preset → Extensions
Support** — because a plain web export has no dynamic linker in it at all. It also needs the
extension built with an Emscripten whose libc++ matches the one Godot's own templates were
built with; a newer one links fine and then aborts at load on a symbol the main module does
not export. Web is experimental for exactly these two reasons, neither of which is ours to
pin. [`docs/performance.md`](performance.md) records what that check found.

## The dev preview

The chrome `zabloo dev` serves — topbar, stage, console, statusbar and the floating bindings
panel — is described in
[Project structure & CLI](project-structure.md#the-preview). These are the four things about
it that send people looking.

### "Stale" and "Disconnected" are not the same thing

They are the two ways the pill in the topbar stops being green, and they want opposite
reactions:

| Pill | What it means | Where to look |
|---|---|---|
| **Live** (green) | The event stream is up and the last export loaded. What is on the canvas is the file on disk. | — |
| **Stale** (amber) | The server is fine; the **export** failed. The canvas is showing the last good render, which is now older than your source. | The **Problems** tab, and the pill's own tooltip — it carries the export's message. |
| **Disconnected** (red) | The event stream is gone: `zabloo dev` was stopped, the machine slept, a proxy dropped an idle connection. Nothing is watching your saves. | The terminal `dev` is running in. Reload the page once it is back. |

A red pill is never about your UI, and an amber one is never about the connection. If the
statusbar says `Disconnected` while the terminal is plainly still running, the stream died
in between — behind a proxy, a Codespace or a tunnel, that is usually an idle timeout, and
the preview's own keep-alive covers the common ones.

### The canvas is greyed out

That veil is the [stale treatment](project-structure.md#when-an-export-fails), and there is
always a pill on top of it saying so. It means one of two things, both of which the
**Problems** tab spells out:

- **The export failed** — a `zabloo export: <message>` from the authoring errors above.
  Fix it and save; the veil lifts on the next good export.
- **The envelope loaded with a `fatal`** — the view on screen never loaded. Fatals sort to
  the top of the tab and each names its code and its path into the envelope; a row about
  another view is a link to it.

The canvas is **deliberately not** blanked or covered by an error box: the last good render
is the thing you were looking at, and hiding it would cost you the comparison you need to
fix the problem. The bindings panel goes inert for the same reason — pushing a value into a
view that is not the one you are editing would be a lie — and its footer says the values are
held. They are: they go back in when the export loads.

### The bindings panel disappeared

`×` closed it. The topbar's `{ } Bindings` toggle brings it back, and it reflects the
panel's state, so a lit button and no panel means the panel is off-screen rather than
closed — which the grip fixes: **click** the grip to reset the position, **drag** it to move
it. The open state and the position are both remembered across reloads.

Two states that look like a bug and are not: a view that declares no bound paths shows a
`No bindings` card (a view with no data is a normal view), and every field going grey is the
stale treatment above, not a broken panel.

### The preview looks wrong at 4K (or on a laptop)

The canvas is laid out at the **viewport preset**, not at the window. Under a fixed preset —
1080p, 4K TV, Ultrawide, Steam Deck, Switch, a phone, or a custom `W×H` — the canvas keeps
that declared pixel size and a CSS transform shrinks it to fit; the caption above it reads
`preset · resolution · @DPR · zoom` so the scale is never a guess. Two consequences worth
knowing:

- **The zoom never goes above 1.** A 720p view on a 4K monitor is drawn at 720p and centred,
  not blown up: scaling it would show you resampling instead of your UI. If a preset looks
  small, that is the preset being smaller than your window.
- **`Fit window` is the only preset with no scaling in it.** The canvas takes the area and
  the frame drops its border — so a layout that only breaks under `Fit window` is a layout
  that depends on a size you have not pinned.

If the text looks soft or the atlases look wrong, that is the **DPR** control next to the
picker: `auto` follows the browser, and `1×`/`2×`/`3×` force it. Changing it remounts the
view, because the glyph atlases are rasterized at that scale.

## Related

- [The host channel](format/host-channel.md) — the operations, their return values and the
  callbacks, with the Godot spelling of each.
- [Loading](format/loading.md) — the validation policy and every diagnostic code.
- [`@zabloo/react` reference](react-api.md) — the API these errors are thrown from.
- [Project structure & CLI](project-structure.md) — where the export looks for things.
