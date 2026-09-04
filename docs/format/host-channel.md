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
operations, and **signals** for the callbacks. The **Unity** SDK exposes it on the
`ZablooView` component, spelled the way a C# class is: `PascalCase` methods, and C#
**events** for the callbacks.

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
| `SetValue` | `set_value(id: String, value: float) -> bool` | | |
| `SetText` | `set_text(id: String, text: String) -> bool` | | |
| `SetScroll` | `set_scroll(id: String, x: float, y: float) -> bool` | | |
| `Reload` | `reload(json: String) -> bool` | | |

A `Variant` carries what the channel carries: a bool, a number, a string, and — because a
bound path addresses **into** what was pushed — an `Array` or a `Dictionary` too.
`set_data("shop.items", [...])` is what makes `{"bind": "shop.items.1.name"}` resolve.

The `action` signal's `context` is the `ActionContext` below as a `Dictionary`, with the
same keys (`path`, `key`, `index`) — and empty for an action fired from the document
itself, since GDScript has no absent value that reads better than an empty dictionary.

The keyboard has one Godot-only wrinkle, and it belongs to the `Slider`. Arrow keys along a
slider's axis adjust it and the release of that key is what fires `onCommit`, but the core
is only ever told about presses — so `ZablooView` calls the runtime's `settle_slider_keys()`
when the arrow comes up. It is adapter plumbing, not an operation: a game never calls it.

### Unity spelling

| Operation | Unity | Callback | Unity event |
|---|---|---|---|
| `SetData` | `SetData(string path, object value)` | Action | `event Action<string, ActionContext> OnAction` |
| `SetOpen` | `SetOpen(string id, bool open) → bool` | Data changed | `event Action<string, object> OnDataChanged` |
| `SetSelectedTab` | `SetSelectedTab(string id, int index) → bool` | Diagnostic | `event Action<Diagnostic> OnDiagnostic` |
| `SetChecked` | `SetChecked(string id, bool isChecked) → bool` | | |
| `SetValue` | `SetValue(string id, double value) → bool` | | |
| `SetText` | `SetText(string id, string text) → bool` | | |
| `SetScroll` | `SetScroll(string id, float x, float y) → bool` | | |
| `Reload` | `Reload(string json) → bool` | | |

`SetData` takes what JSON can carry: `null`, `bool`, any numeric primitive, `string`, arrays
and lists (any `IEnumerable`), and dictionaries keyed by string (`Dictionary<string, object>`,
`Dictionary<string, int>`…). `SetData("shop.items", new List<Dictionary<string, object>>
{ … })` is what makes `{"bind": "shop.items.1.name"}` resolve. Anything else — a
`GameObject`, a `NaN` — is warned about and **nothing is written**: guessing at a value
would push the wrong thing in silence. Numbers are written with
`CultureInfo.InvariantCulture` whatever the player's locale, so a game running on a Spanish
machine still pushes `0.5`, never `0,5`.

What comes back is typed by shape, not by declaration — the format has no data types, and
the value arrives as JSON from the core:

| JSON | C# `object` |
|---|---|
| `true` / `false` | `bool` |
| an integer that fits (`1200`) | `long` |
| any other number (`0.35`, `1e21`) | `double` |
| a string | `string` |
| an array | `List<object>` |
| an object | `Dictionary<string, object>` |
| `null` | `null` |

`Convert.ToInt32(value)` and `Convert.ToDouble(value)` work on either number type; a game
that wants the split checks `value is long`.

`ActionContext` is a `readonly struct` with the same three fields as the web's, plus one
question: `Path` (`string`, or null), `Key` (`object`: a `string`, a `long`/`double` by the
rule above, or null when the list is positional), `Index` (`int`, `-1` without a context)
and **`HasContext`** — `false` for an action fired from the document itself, where the
struct is `default`. It carries the innermost item, and `Path` is an address, so it is also
what the game writes back through with `SetData`.

`Diagnostic` is a `readonly struct` too: `Code` (the stable code), `Path` (into the
envelope, or null), `Message`, and `Fatal` — see [Loading](loading.md#in-unity).

**Events are drained after the frame, never raised from inside it.** The core produces no
callbacks: `ZablooView` reads what a frame produced once the frame is done and raises the
events then, in the order the frame produced them. A handler therefore never runs in the
middle of a layout pass, and a game that re-enters from one — a `SetData` in response to an
action, a `Reload` from a diagnostic — finds the view settled. That drain runs after every
frame the view paints, including one of pure motion: a toast's `autoCloseMs` fires from
inside the layout pass, and its `onDismiss` and the `false` it writes reach the game on that
same frame rather than with the player's next input.

The **loading** half, which the Godot table folds into `load_envelope`/`load_file`:

| Member | What it does |
|---|---|
| `LoadEnvelope(string json) → bool` | Loads an envelope and shows the view named in the inspector (or the envelope's first). The one loading path: a manual import, a dev push and a hot-update all arrive here. |
| `LoadEnvelope(string json, string view) → bool` | The same, showing `view`. An id the envelope lacks is warned about and the first view shows; the load still took. |
| `Load(TextAsset asset) → bool` | `LoadEnvelope` over an imported `dist/zabloo.ir.json`. Runs on enable for the asset assigned in the inspector, and from its **Reload from asset** context-menu entry. |
| `ShowView(string id) → bool` | Another view of the loaded envelope. `false`, and a warning, when there is none; nothing changes then. |
| `Reload(string json) → bool` | `LoadEnvelope` keeping the view on screen — the hot-update path. |
| `IsLoaded` | Whether a view is on screen. A refused load does not count. |
| `Diagnostics` | `IReadOnlyList<Diagnostic>`: the last load's, worst first. |

Nothing throws. A refused payload answers `false`, leaves what was on screen exactly where
it was, and says why on `OnDiagnostic` and in `Diagnostics`. Data the game pushed
**survives** a swap, because the store lives in the core's document and the component caches
nothing of its own.

And the **introspection** half: `Snapshot()` is the `ViewSnapshot` as the JSON a golden
file holds (what the corpus test inside Unity compares against `golden/metrics/`), `Stats`
is what the last paint cost, and `MarkDirty()` asks for a frame — every operation above
already calls it, so a game only needs it for something the component cannot see.

The `Slider`'s keyboard wrinkle is the same as Godot's, and it lands on the same side of the
line: the arrow along a slider's axis adjusts it and `onCommit` belongs to the key coming
**up**, which the core is never told about — so the keyboard half of the adapter calls the
runtime's `settle_slider_keys` on the key up. Adapter plumbing, not an operation.

### The gamepad, and remapping it

The [gamepad](input.md#gamepad) needs nothing from a game to work: `ZablooView` reads the
first connected joypad every frame while one is plugged in — a pad is a state that is
**polled**, never an event that arrives — and stops the moment the last one goes. With no
pad connected it asks for no frames at all.

What it reads is Godot's standard mapping: `JOY_BUTTON_A` presses, `JOY_BUTTON_B` goes
back, the d-pad and the left stick navigate, the right stick scrolls the `ScrollView` the
focus lives in. Those numbers are Godot's own and not the ones the rules are written in —
Godot puts the d-pad at 11–14 where the standard mapping puts it at 12–15 — and the adapter
translates, so the behaviour is the same on every target.

A console title has its own remapping screen, and the UI has to follow it rather than
insist on the factory layout. Three methods do that. A **slot** is what the runtime asks
for; what fills it is the game's business:

| Slot | Read by default from |
|---|---|
| `a`, `b` | `JOY_BUTTON_A`, `JOY_BUTTON_B` |
| `dpad_up`, `dpad_down`, `dpad_left`, `dpad_right` | the four `JOY_BUTTON_DPAD_*` |
| `nav_x`, `nav_y` | `JOY_AXIS_LEFT_X`, `JOY_AXIS_LEFT_Y` |
| `scroll_x`, `scroll_y` | `JOY_AXIS_RIGHT_X`, `JOY_AXIS_RIGHT_Y` |

```gdscript
view.set_pad_button("a", JOY_BUTTON_B)          # swap A and B
view.set_pad_action("a", &"ui_accept")          # or follow an InputMap action
view.set_pad_axis("scroll_y", JOY_AXIS_LEFT_Y)  # scroll with the left stick
```

`set_pad_action` takes **button slots only**: an action is a boolean and an axis is
bipolar, so the sticks are remapped by index (`-1` switches a slot off). Naming a button
for a slot also takes any action back off it. Each answers whether the slot exists — a
typo is answered, never fatal, like the id operations above.

The **Unity** spelling is the same three, on the component, over the Input System —
`SetPadButton("a", GamepadButton.East)`, `SetPadAction("a", inputActionReference)` (an
`InputAction` the game already rebound; `null` hands the slot back to its button), and
`SetPadAxis("scroll_y", PadMapping.AxisLeftY)` with `PadMapping.AxisOff` to switch a slot
off. The factory layout is `Gamepad.current`'s standard map: south presses, east goes back,
d-pad and left stick navigate, right stick scrolls — read as positions, so a DualShock's
cross and circle fill the same slots with nothing configured. The slot names are the ones
in the table.

**Exactly one view reads the pad**, for the same reason exactly one reads the keyboard: a
device belongs to the process, so two views in a scene would each walk their own focus on
one push of the stick. See [who the keys belong to](input.md#who-the-keys-belong-to-normative).

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
