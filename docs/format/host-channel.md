# The host channel

The game drives the UI through the SDK's API, not through the document. It is the
counterpart of the [actions](bindings.md) coming the other way: actions travel from the UI
to the game, and everything on this page travels back.

It is deliberately **not** in the IR. These are runtime operations — "open that collapse",
"the player now has 1250 gold" — and a document has no place to put them. Which is also why
they are the same everywhere: the operations, their arguments and their effects are part of
the contract; only the spelling follows each engine's conventions.

```
game ──── SetData / SetOpen / SetChecked / … ────▶ UI
     ◀─── onAction / onDataChanged / onDiagnostic ───
```

The signatures below are the **web target**'s (`@zabloo/renderer-web`), given inline as the
concrete spelling of each operation. The **Godot** SDK exposes the same contract on the
`ZablooView` node, spelled the way an engine node is: `snake_case` methods for the
operations, and **signals** for the callbacks.

## The operations (normative)

| Operation | Web spelling | What it does |
|---|---|---|
| `SetData` | `setData(path: string, value: unknown): void` | Writes into the data store. Every binding reading that path updates, and the layout re-runs where it must. |
| `SetOpen` | `setOpen(id: string, open: boolean): boolean` | Opens or closes a [`Collapse`](../components/collapse.md). |
| `SetSelectedTab` | `setSelectedTab(id: string, index: number): boolean` | Selects a tab of an `"exclusive-select"` group, by the **group container's** id. |
| `SetChecked` | `setChecked(id: string, checked: boolean): boolean` | Sets a [`Toggle`](../components/toggle.md). |
| `SetValue` | `setValue(id: string, value: number): boolean` | Moves a [`Slider`](../components/slider.md) — exactly the gesture the player would have made, hooks included. |
| `SetText` | `setText(id: string, text: string): boolean` | Writes a [`TextInput`](../components/textinput.md)'s text, as if it had been typed. |
| `SetScroll` | `setScroll(id: string, x: number, y: number): boolean` | Moves a [`ScrollView`](../components/scrollview.md)'s offset. |

### Godot spelling

| Operation | Godot | Callback | Godot signal |
|---|---|---|---|
| `SetData` | `set_data(path: String, value: Variant)` | Action | `action(name: String, context: Dictionary)` |
| `SetOpen` | `set_open(id: String, open: bool) -> bool` | Data changed | `data_changed(path: String, value: Variant)` |
| `SetSelectedTab` | `set_selected_tab(id: String, index: int) -> bool` | Diagnostic | `diagnostic(code: String, message: String, fatal: bool)` |
| `SetChecked` | `set_checked(id: String, checked: bool) -> bool` | | |
| `Reload` | `reload(json: String) -> bool` | | |

A `Variant` carries what the channel carries: a bool, a number, a string, and — because a
bound path addresses **into** what was pushed — an `Array` or a `Dictionary` too.
`set_data("shop.items", [...])` is what makes `{"bind": "shop.items.1.name"}` resolve.

`SetValue`, `SetText` and `SetScroll` are not on the Godot node yet: their subjects
(`Slider`, `TextInput`, `ScrollView`) have no runtime there until ZAB-143, ZAB-144 and
ZAB-139. Binding them now would mean answering `false` for a control that exists, which is
the one thing the return value is not allowed to mean.

### Addressing by id

Every operation but `SetData` names a node by its `id`, so the nodes a game drives carry
one. Ids are expected to be unique within a view; duplicates load with a warning and
resolve to the first match.

**The id operations answer whether they found the control.** A `false` means no node of
that type carries that id — a typo, a view that was hot-updated out from under the caller,
a node whose `visible` took it out of the tree — and **nothing was applied**. It is not an
exception: a game looping over ids must not die because one screen changed. The web target
also logs the miss (`[zabloo] setChecked: no Toggle with id "…"`).

An `id` **inside a [`Repeat`](../components/repeat.md) template** is worn by every instance
of it, and the lookup keeps the last one realized. Addressing a particular row by id is not
something v1 does — a press inside a row comes back with its `ActionContext` instead, which
says *which* item it was.

### Data writes are cached and replayed

`SetData` writes into a store, not into the tree. Data pushed **before a view is mounted**,
or before a bound node exists, applies as soon as it does — a game pushes its state
whenever it has it, and a UI loaded later still comes up filled in.

The store is also what a `Repeat` reads: writing the array (`shop.items`) moves the
bindings inside it (`shop.items.3.name`), and writing into one item moves a binding watching
the whole array.

### Driving a control is the player's gesture

The value operations do not poke state — they run the same path the player's finger does,
so a game and a player produce identical results:

- `SetValue` clamps and quantizes to the slider's `min`/`max`/`step`, fires `onChange`, and
  then fires `onCommit` — the whole gesture, press to release, in one call.
- `SetChecked` fires the toggle's `onChange` and, inside a group, the group's.
- `SetText` replaces the buffer and leaves the caret **at the end**, where someone handed a
  prefilled value would start typing.
- `SetScroll` is clamped to the last relayout's bounds.
- A control whose value is a **read/write binding** writes the new value back through it, so
  the game hears it on `onDataChanged` exactly as it would from a real gesture.

## The callbacks

| Callback | Web spelling | When it fires |
|---|---|---|
| Action | `onAction(action: string, context?: ActionContext)` | A named action declared in the IR (`onClick`, `onChange`, `onCommit`, `onSubmit`, `onDismiss`) fired. |
| Data changed | `onDataChanged(path: string, value: unknown)` | A control wrote its value into a bound path. |
| Diagnostic | `onDiagnostic(diagnostic: Diagnostic)` | The [loading contract](loading.md) found something, on `mount` and on `reload` alike. |

**`onDataChanged` never fires for `SetData`.** That value came from the game; echoing it
back would make every write a round trip.

`ActionContext` is present only for an action fired from **inside a repeated item**, and it
describes the innermost one:

| Field | Type | Meaning |
|---|---|---|
| `path` | `string` | Absolute data path of the item — `"shop.items.3"`. |
| `key` | `string \| number` | The item's raw key, when the `Repeat` declares one. Absent when identity is positional. |
| `index` | `number` | Position in the array. |

A `Diagnostic` carries a stable `code`, the `path` into the envelope it sits on, a `level`
(`"warn"` or `"fatal"`) and a self-contained `message` — see
[Loading](loading.md#diagnostics) for the full code table. A `warn` was repaired and the
envelope loaded without the broken part; a `fatal` means nothing loaded, and it arrives
**before** `mount` throws. Without the callback, warnings go to the console.

## Mounting a view

```ts
import { mount } from "@zabloo/renderer-web";

const canvas = document.querySelector("canvas") as HTMLCanvasElement;
const envelope = await fetch("/zabloo.ir.json").then((r) => r.text());

const ui = mount(canvas, envelope, {
  view: "main-menu",
  background: "#11141d",
  onAction: (action, context) => {
    if (action === "play") startGame();
    if (context) console.log("fired from item", context.path, context.index);
  },
  onDataChanged: (path, value) => console.log("player wrote", path, "=", value),
  onDiagnostic: ({ level, code, path, message }) => showInEditor(level, code, path, message),
});

await ui.ready;

ui.setData("player.gold", 1250);
ui.reload(nextEnvelope);
ui.dispose();
```

`mount(canvas, envelope, options?)` takes the envelope as JSON text or as a parsed object.

| `MountOptions` | Type | Default | Description |
|---|---|---|---|
| `view` | `string` | the envelope's first view | View id to render. |
| `onAction` | `(action, context?) => void` | none | Named actions, with the item's context when there is one. |
| `onDataChanged` | `(path, value) => void` | none | The return leg of the data channel. |
| `onDiagnostic` | `(diagnostic) => void` | console | Where the loading contract's diagnostics go. |
| `background` | `string` | `"#101218"` | Canvas clear color (CSS hex). |
| `dpr` | `number` | the browser's | Device pixel ratio to render at, instead of `devicePixelRatio`. |
| `onFrame` | `(stats) => void` | none | Fires once per frame actually painted, with what it cost. |

**`dpr` is fixed for the life of the mount.** The renderer reads the ratio everywhere it
turns logical pixels into device ones — the backing store, the glyph atlas scale, the pixel
grid quads snap to — so overriding it means rebuilding the atlases; a host that offers it as
a control (a preview's DPR selector, a golden harness pinned to a fixed ratio) remounts.

**`onFrame` is the only way to get a frame RATE.** `stats()` answers what the LAST frame
cost, and polling it cannot become a rate because the renderer paints on demand: a still
scene paints nothing at all, and the caller's own `requestAnimationFrame` would be measuring
the page rather than the renderer. It receives `FrameStats` plus an `ms` — the time inside
tessellate + submit, excluding the GPU's own asynchronous execution.

**`mount` throws** an `EnvelopeError` if the payload is unusable — there is no previous UI
to protect, and the caller has to hear that its payload never became a view. It is the only
entry point that throws.

## The handle

| Member | Type | What it is |
|---|---|---|
| `viewIds` | `string[]` | The **current** envelope's view ids. A getter: a hot-update may add, drop or rename views, so a view picker re-reads it after every `reload` instead of keeping the array it got at mount. |
| `ready` | `Promise<void>` | Resolves once the view has swapped in its own text rasterizer and repainted with it. Anything comparing metrics — a golden test, a screenshot — waits on this. It never rejects: a failed load keeps the browser's metrics. |
| `reload(envelope)` | `(string \| object) => void` | Hot-update, the same loading path a shipped SDK uses. |
| `snapshot()` | `() => ViewSnapshot` | The frame's measurements — see below. |
| `stats()` | `() => FrameStats` | What the last painted frame cost — see below. |
| `dispose()` | `() => void` | Releases the canvas, the GL resources and the listeners. Idempotent. |

The seven [id operations](#the-operations-normative) — `setData`, `setOpen`, `setSelectedTab`,
`setChecked`, `setValue`, `setText`, `setScroll` — are members of this same handle; they are
tabled above because they are the normative surface every target implements, and these six
are the web binding's own.

**`reload` never throws.** A payload the validator refuses — truncated, corrupt, a major
version this reader does not implement — is reported through `onDiagnostic` and
**discarded**: the view on screen stays exactly as it is. A bad hot-update costs the player
an update, never their session.

**A reload snaps.** There is no previous value to tween from, so [motion](motion.md) starts
from the new frame; the same is true of mounting.

After `dispose()`, the id operations return `false` and the view warns once rather than once
per call.

## In the browser console

`zabloo dev`'s preview puts the handle of the view it has mounted on `window.zabloo`, so the
browser's own console is a REPL against the running UI — the third way to push a value,
beside the [bindings panel](../project-structure.md#the-preview) and the game itself:

```js
zabloo.setData("player.gold", 1250);
zabloo.setData("shop.items", [{ id: "sword-01", name: "Iron sword", price: 120 }]);
zabloo.setChecked("sfx", true);
zabloo.snapshot();                    // where every rect landed
zabloo.stats();                       // what the last painted frame cost
```

Everything on the handle is there:

| | |
|---|---|
| Data | `setData(path, value)` |
| Controls | `setChecked(id, on)` · `setValue(id, n)` · `setText(id, s)` · `setOpen(id, open)` · `setSelectedTab(id, i)` · `setScroll(id, x, y)` |
| Introspection | `snapshot()` · `stats()` · `viewIds` |
| Content | `reload(json)` |

The reference is **replaced on every mount**. An ordinary save is a `reload` and keeps the
same handle, but changing the view or the DPR mounts a new one — so a `const ui = zabloo`
held across either is a disposed view whose id operations answer `false`. Read `zabloo`
fresh each time. While no view is mounted the property is `undefined` rather than a stale
handle.

## Introspection

### `snapshot()` — the frame's measurements

`ViewSnapshot` is the **cross-target contract**: the same envelope loaded in another SDK
must produce this same document. It answers what a screenshot cannot explain — where every
rect landed, where the text broke and on which baselines it sits, what left the layout, what
clips what, in what order the layer paints, and where focus/hover/press ended up. Pixels are
deliberately absent.

| Field | Type | Meaning |
|---|---|---|
| `view` | `string` | The view id on screen. |
| `size` | `{ width, height }` | The canvas in CSS px. |
| `focus` / `hover` / `pressed` | `string \| null` | The `ref` of the node holding each state. |
| `layer` | `LayerSnapshot[]` | Overlays in `(z, document order)`, bottom-most first, each with its `presence` (0..1 while fading). |
| `tree` | `NodeSnapshot` | The tree, from the root. |

A `NodeSnapshot` carries its `type`, a `ref` (the node's `id`, or its positional path from
the root — `"0.2.1"`), and then only what says something: `rect`, `measured`, `states`,
`style` (tokens collapsed, transitions applied), `text` (lines, widths, baselines,
`truncated`), `clip`, `scroll`, `value`, `field`, `window` and `children`. **Absent means
default** — an unfocused node carries no `states`, an unclipped one no `clip` — and a node
that is out of layout carries `out` and nothing else.

Three rules keep a diff readable: keys are written in a **fixed order**, absent means
default, and floats are **rounded once** (3 decimals) so the last bits of an FMA never
rewrite a golden file.

Read one node with `findNode(snapshot, "buy-btn")`, or serialize the whole thing with
`serializeSnapshot(snapshot)`.

### `stats()` — what the frame cost

`FrameStats` is **web-only telemetry and not normative**: none of it is a cross-target
metric, which is why it sits beside `snapshot()` instead of inside it. It is what the
renderer's performance budgets are asserted against.

| Field | Meaning |
|---|---|
| `drawCalls` / `vertices` / `indices` | The frame's submitted geometry. |
| `atlases` / `atlasBytes` | Live glyph atlases, and the CPU bytes of their bitmaps. |
| `resolved` | Nodes the resolve pass visited — the CPU work before layout. Zero on a repaint-only frame. |
| `textLayouts` | Texts re-broken into lines. A steady frame over a static scene must sit at **zero**. |
| `bufferGrowths` | Geometry buffers that had to grow. Zero once the scene has been painted at full size. |
| `repaintOnly` | The frame skipped the whole pipeline before tessellation — nothing changed but pixels (a blinking caret). |

## Related

- [Bindings & actions](bindings.md) — the two mechanisms this channel is the other half of.
- [Loading](loading.md) — what a refused payload does, and the diagnostic codes.
- [Versioning](versioning.md) — what an older SDK does with newer content.
