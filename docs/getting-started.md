# Getting started

Build a shop screen, bind it to game data, wire a button to C#, and load the result in
Unity. Roughly twenty minutes, no engine needed until the last step.

This is the tutorial. The rest of `docs/` is the **reference** — normative pages that say
exactly what every SDK must do. This page instead builds one screen from nothing, and links
out whenever a concept has a page of its own.

**You need** Node 22+ and pnpm. Unity (2022.3 LTS or newer) only for step 6 — the first five
steps run entirely in the browser preview.

> **Pre-release.** The packages are not on npm yet, so `npx create-zabloo-app` will not
> resolve until they are published. From a clone of this repository, scaffold into the
> workspace instead — `--workspace` wires the project to the local packages:
>
> ```bash
> pnpm install && pnpm build
> node packages/create-zabloo-app/dist/index.js examples/my-game-ui --workspace
> pnpm install                       # links @zabloo/react and @zabloo/cli into it
> cd examples/my-game-ui && pnpm dev
> ```
>
> Every other command on this page is what you will actually run.

---

## 1. Scaffold and first run

```bash
npx create-zabloo-app my-game-ui
cd my-game-ui
pnpm install
pnpm dev
```

Open **http://localhost:5078**. You are looking at the scaffolded `main-menu` view, drawn by
[`@zabloo/renderer-web`](../packages/renderer-web) — the same self-render pipeline the
in-engine SDK runs: its own Flexbox pass, its own tessellator, its own glyph atlas. There is
no DOM in that canvas. What you see is what the game will draw.

Four things in the preview earn their keep:

| | What it does |
|---|---|
| **View selector** | Every `.tsx` in `src/views/` is a view. Switch between `main-menu` and `settings` from the topbar. |
| **Bindings panel** | The card floating over the canvas. It auto-discovers every bound path in the envelope and gives you a typed field per path. This is you playing the role of the game. |
| **Actions tab** | The console's first tab: every named action the UI fires, as the game would receive it. |
| **Keyboard** | Inside the canvas, arrows move focus spatially and Enter/Space press. The statusbar's gamepad indicator lights up if you plug one in. |

The rest of the chrome — viewport presets, the DPR control, the Problems and Stats tabs,
zen mode — is in [Project structure & CLI](project-structure.md#the-preview).

The project itself:

```
my-game-ui/
├── src/
│   ├── views/        one .tsx per view — the filename is the view ID the SDK loads by
│   ├── components/   your React components (they never reach the IR)
│   ├── assets/       images; the export inlines them in the envelope
│   └── theme.ts      tokens, variants and motion
├── zabloo.config.ts
└── package.json      dev · dev:unity · build
```

## 2. Your first screen

Open `src/views/main-menu.tsx` and replace it with something small enough to own every line
of:

```tsx
import { Column, Text } from "@zabloo/react";

export default function MainMenu() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: 16 }}>
      <Text style={{ color: "#eceff4", fontSize: 28 }}>Guild shop</Text>
    </Column>
  );
}
```

Save. The preview re-exports and reloads on its own — that is `pnpm dev` watching.

> ### The one thing to understand first
>
> **Your `.tsx` runs once, at authoring time, and its output is data.**
>
> `zabloo export` executes your components on your machine and writes an **IR envelope**:
> JSON describing a tree of nodes, styles and declared hooks. The game never runs React,
> never runs JavaScript, and never sees `MainMenu`. It loads that JSON and draws it.
>
> Which means the React reflexes do not apply:
>
> | Coming from React | Here |
> |---|---|
> | `useState`, `useEffect`, re-renders | None at runtime. There is one render, during export. |
> | `onClick={() => buy()}` | `onClick="buy"` — a **name**, not a function. Functions cannot be serialized. |
> | `{gold > 0 && <Text/>}` | Evaluated at export, frozen forever. Runtime conditions are [bindings](format/bindings.md). |
> | Your components in a devtools tree | They vanish. Only [the 13 node types](components/README.md) reach the IR. |
>
> `.map()`, props, helper functions, splitting things into components — all of that works
> exactly as you expect, because it all happens before the JSON exists. What cannot cross
> into the IR is anything that would need to *run* later.

Everything dynamic in a zabloo UI is therefore built from exactly two declared hooks, and
the next two steps are those two hooks.

## 3. Data: bindings

The game owns the data. The UI declares *where* to read it. Add a gold counter — a `<Text>`
with `bind` instead of children:

```tsx
import { Column, Row, Text } from "@zabloo/react";

export default function MainMenu() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: 16 }}>
      <Row layout={{ width: 420, justify: "space-between", align: "center" }}>
        <Text style={{ color: "#eceff4", fontSize: 28 }}>Guild shop</Text>
        <Row layout={{ gap: 8, align: "center" }}>
          <Text style={{ color: "#facc15", fontSize: 20 }}>Gold:</Text>
          <Text bind="player.gold" style={{ color: "#facc15", fontSize: 20 }} />
        </Row>
      </Row>
    </Column>
  );
}
```

Save, and look at the preview's **bindings panel**: `player.gold` appeared on its own, with
a number field beside it. Type `1250` into it. The text fills in and the row re-lays out
around its new width.

`bind` on `<Text>` is shorthand. Every other bindable prop takes the object form — a literal
`T` or `{ bind: "path" }`:

```tsx
<Text visible={{ bind: "shop.thanked" }} style={{ color: "#4ade80" }}>
  Thanks for your purchase
</Text>
```

Add that as the last child of the `<Column>`. It is invisible until something sets
`shop.thanked` — the panel now has a field for it too, a switch this time. The editor comes
from **where** the path is bound, not from what the value happens to be: `visible` is a
boolean everywhere, so it gets a switch before the game has pushed anything at all.

A path is a dot-separated address into the game's data, where a numeric segment indexes an
array: `player.gold`, `shop.items.3.name`. Reading never throws — a missing path renders
nothing rather than breaking the frame.

Three ways to push a value, all the same channel:

```js
// 1. The bindings panel — a field per bound path.
// 2. The browser console: the live view handle is on `window`.
zabloo.setData("player.gold", 1250);
```

That handle is the whole [host channel](format/host-channel.md#in-the-browser-console),
not just `setData`.

```csharp
// 3. The game, once you get to step 6.
document.SetData("player.gold", 1250);
```

**What can be bound:** `visible` and `disabled` on every node, `text`, a `ProgressBar`'s
`value`, a `Repeat`'s `items` — the game pushes, the UI follows. And read/**write**, where
the SDK writes back and tells the game: a `Toggle`'s `checked`, a `Slider`'s `value`, a
`TextInput`'s `value`. That is what makes a bound `<TextInput>` and a `<Text>` on the same
path stay in sync with zero game code.

Two deliberate limits, worth internalizing now:

- **No expressions.** No arithmetic, no formatting, no conditionals. A value is shown as it
  is. Anything that needs deciding is decided by the game, which then moves a value the UI
  is bound to.
- **`style` is not bindable.** A bar that turns red when it is low is done by the game
  moving a *token*, not by the UI computing a color.

Full rules: [Bindings & actions](format/bindings.md).

## 4. Actions, and a list

An action is a **string the game chose**. The IR declares that the hook exists; what happens
is never in the JSON.

The interesting case is not one button — it is a button inside a data-driven list, where the
same `"buy"` has to say *which* row was pressed. `<List>` emits the item template **once**
and the SDK instantiates it per element of the bound array:

```tsx
import { Button, Column, List, Row, Text } from "@zabloo/react";
```

```tsx
<List
  items="shop.items"
  as="it"
  keyPath="id"
  layout={{ width: 420, gap: 8, align: "stretch" }}
  empty={<Text style={{ color: "#9aa4b2" }}>Nothing in stock — push `shop.items`</Text>}
>
  {(it) => (
    <Row
      layout={{ height: 56, padding: 8, gap: 8, align: "center" }}
      style={{ background: "#1f2430", radius: 8 }}
    >
      <Column layout={{ grow: 1, gap: 2 }}>
        <Text bind={it("name")} style={{ color: "#eceff4", fontSize: 16 }} />
        <Text bind={it("detail")} style={{ color: "#9aa4b2", fontSize: 13 }} />
      </Column>
      <Text bind={it("price")} style={{ color: "#facc15", fontSize: 15 }} />
      <Button onClick="buy" layout={{ padding: 8, justify: "center", align: "center" }}>
        <Text style={{ color: "#ffffff", fontSize: 14 }}>Buy</Text>
      </Button>
    </Row>
  )}
</List>
```

Drop it between the header row and the thank-you text. The preview shows the `empty` slot —
the IR has no expressions, so "nothing here yet" is a **slot**, not a condition. Feed the
list from the browser console:

```js
zabloo.setData("shop.items", [
  { id: "sword-01", name: "Iron sword", detail: "Damage 12", price: 120 },
  { id: "potion-03", name: "Healing potion", detail: "Restores 40 HP", price: 25 },
]);
```

Four things to notice in that snippet:

- **`as="it"`** names the item alias. Inside the template, `it("name")` is the path
  `it.name`, resolved against the current element; `it.$index` gives its position. A path
  under no alias stays absolute, which is how a row still binds `player.gold`.
- **`keyPath="id"`** is the item's stable identity. It keeps per-item runtime state — the
  focus ring, a checked toggle, an in-flight transition — with its item when the game
  reorders the array, and it is what lets the renderer recycle rows. It is `keyPath` and not
  `key` because React owns `key`.
- **One `id`-free template.** An `id` inside a template would be worn by every instance of
  it, so rows are addressed by data path, never by node id.
- **The template is a single node.** `<List>` throws if you hand it two, because the
  primitive's `children[0]` *is* the template and `children[1..]` are the empty state.

Now press **Buy** on a row and watch the console's **Actions** tab:

```
buy → shop.items.0 (#0)
```

That suffix is the **action context**: an action fired from inside a repeated item carries
`path` (the item's absolute path), `index`, and `key` when the list declares one. `path`
embeds every enclosing index, so nested lists work from the innermost item alone.

> **Status.** The action context is in the format ([`ActionContext`](format/bindings.md#action-context)
> in `@zabloo/format`) and the web preview logs it, as above. The Unity SDK's `OnAction` is
> `Action<string>` today — it delivers the action **name** only, and surfacing the context in
> C# comes later. Until then, a Unity game that needs to know which row was pressed reads
> the selection from its own state.

## 5. Theme and variants

The screen works and is full of hex codes. Move them into `src/theme.ts`, which already ships
every token this screen needs — an excerpt of the generated file:

```ts
export const tokens = {
  "color.primary": "#4f46e5",
  "color.primary.hover": "#6366f1",
  "color.on-primary": "#ffffff",
  "color.surface": "#1f2430",
  "color.text": "#eceff4",
  "color.muted": "#9aa4b2",
  "color.gold": "#facc15",
  "radius.md": 8,
  "space.2": 8,
  "space.3": 12,
  // Motion is a token like any other.
  "motion.fast": 120,
};
```

A **token reference** is a string in braces: `"{color.gold}"` in place of `"#facc15"`,
`"{space.2}"` in place of `8`. Styles do not bake values — the SDK resolves references per
node at render time against the envelope's flat dictionary, which is why swapping the
dictionary re-themes the whole UI **without re-emitting the tree**. Set `motion.fast` to `0`
and the UI stops animating; nothing else changes.

Then give the buy button a **variant** — a named style set in the theme. Add `buy` next to
the variants the scaffold already declares (`primary`, `secondary`, `tab`, `setting` — the
settings view uses them):

```ts
export const variants: ThemeVariants = {
  Button: {
    buy: {
      style: { background: "{color.primary}", radius: "{radius.md}" },
      states: {
        hover: { style: { background: "{color.primary.hover}" } },
        pressed: { style: { background: "#4338ca" } },
        // A focus ring is an inset border — it paints inside the layout rect.
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
      },
    },
  },
};
```

```tsx
<Button variant="buy" onClick="buy" layout={{ padding: "{space.2}", … }}>
```

Hover it, tab to it — the states are the SDK's, keyed by node type, with no game code.

**A variant never reaches the IR.** Unlike a token, which the SDK resolves at render time, a
variant is resolved by `@zabloo/react` **at export time**: the emitted `Button` node carries
the flattened `style` and `states` outright, and the word `buy` appears nowhere in the
envelope. Variants are an authoring convenience; tokens are a runtime indirection. That is
also why they are keyed by **primitive**: `<Checkbox>` and `<Switch>` both look under
`Toggle`, because that is what they lower to.

The same file's `transitions` block sets default motion per primitive, so every `Button`
tweens without a prop on any of them:

```ts
export const transitions: ThemeTransitions = {
  Button: { duration: "{motion.fast}" },
};
```

A node's own `transition` still wins. More: [Style](format/style.md) · [Motion](format/motion.md).

## 6. Export and load it in the game

```bash
pnpm build     # → dist/zabloo.ir.json
```

One file, and it is the whole deliverable — [the envelope](format/envelope.md):

```jsonc
{
  "v": 1,                                    // IR major version; an SDK refuses a major it does not implement
  "tokens": { "color.gold": "#facc15", … },   // the flat dictionary
  "views": { "main-menu": { "type": "Container", … } },
  "assets": { "logo.png": { "hash": "…", "data": "iVBOR…" } }  // omitted when there are none
}
```

### Unity

The SDK ships as a UPM package, `com.zabloo.sdk` under `sdk/unity` (not yet published — add
it to `Packages/manifest.json` by local path or git URL):

```json
"com.zabloo.sdk": "file:../../path/to/sdk/unity"
```

Then, in the scene:

1. Add a **`ZablooDocument`** to a GameObject. It requires a `UIDocument` and adds one.
2. Drop `dist/zabloo.ir.json` into `Assets/` and assign the imported `TextAsset` to the
   document's **Envelope** field.
3. Set **View** to the view id you want — `main-menu`.

The game talks to the UI through the document, which is the stable handle: the view is
disposable and gets swapped on every reload, while subscriptions survive and pushed data is
replayed.

```csharp
using UnityEngine;
using Zabloo;

[RequireComponent(typeof(ZablooDocument))]
public sealed class ShopDriver : MonoBehaviour
{
    [SerializeField] int _gold = 1000;

    ZablooDocument _doc;

    // Start, not OnEnable: it runs after ZablooDocument has built the view.
    void Start()
    {
        _doc = GetComponent<ZablooDocument>();
        _doc.OnAction += OnZablooAction;
        _doc.SetData("player.gold", _gold);
    }

    void OnDestroy()
    {
        if (_doc != null) _doc.OnAction -= OnZablooAction;
    }

    void OnZablooAction(string action)
    {
        if (action != "buy") return;
        _gold -= 100;
        _doc.SetData("player.gold", _gold);   // the bound Text updates and re-lays out
        _doc.SetData("shop.thanked", true);   // the bound `visible` reveals the row
    }
}
```

`SetData` is cached on the document, so pushing a value before the view exists — or before a
bound node does — applies as soon as it does. Beyond it, the document exposes `Reload(json)`
for hot-swapping content, and `View` for the operations that drive a specific node
(`View.SetOpen(id, open)`).

### The dev loop, in-engine

You do not have to re-export and re-import by hand. Enable **Zabloo → Dev Mode (listen on
localhost:5077)** in the Unity editor and run:

```bash
pnpm dev:unity
```

Every save now hot-swaps the running view in the editor, Play mode included — through the
exact loading path a production hot-update uses. One loading mechanism, three ways in: a
manual import, a dev push, a platform hot-update.

## 7. Where to go next

**The format** — normative reference, one page per concern:

- [The envelope](format/envelope.md) — version, tokens, views, assets.
- [Layout](format/layout.md) — the Flexbox subset every target implements.
- [Style](format/style.md) — the style set, tokens, runtime states and their merge order.
- [Input & focus](format/input.md) — hit-testing, directional navigation, the focus trap.
- [Bindings & actions](format/bindings.md) — everything in steps 3 and 4, exhaustively.
- [Motion](format/motion.md) — what animates, what snaps, the easing curves.
- [Loading](format/loading.md) · [Versioning](format/versioning.md) — how content older or
  newer than the SDK degrades, and what an SDK refuses outright.

**The catalog** — [all 13 node types](components/README.md) and the `@zabloo/react`
components that emit them. Worth a skim before you build a screen: `ScrollView`, `Overlay`
(with `Modal`/`Toast`/`Tooltip`), `Toggle`, `Slider`, `TextInput`, `ProgressBar` and
`Spinner` are all there, plus the composites — `Tabs`, `Accordion`, `Select`, `RadioGroup`,
`Badge`, `Grid` — that flatten to primitives at export time.

**Examples** — runnable projects in [`examples/`](../examples):

| Project | What it shows |
|---|---|
| [`showcase`](../examples/showcase) | The whole catalog, one view per capability: layout, text, controls, lists, overlays, motion, images, theming, navigation. |
| [`hello-button`](../examples/hello-button) | The vertical slice: a pressable button, a `Collapse`, an `Accordion`, a bound `ProgressBar`. |
| [`inventory-demo`](../examples/inventory-demo) | Hundreds of rows in a `ScrollView`, keyed identity, two-way writes from inside a list. |
| [`settings-screen`](../examples/settings-screen) | Tabs, a switch, a slider, a dropdown, a text field — all bound, composed as one real screen. |
| [`unity-playground`](../examples/unity-playground) | A Unity project consuming the SDK, with the driver script from step 6. |

Which one to open for what is in [`examples/README.md`](../examples/README.md).

---

## The finished screen

For diffing against yours — `src/views/main-menu.tsx` at the end of step 5:

```tsx
import { Button, Column, List, Row, Text } from "@zabloo/react";

export default function MainMenu() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: "{space.3}" }}>
      <Row layout={{ width: 420, justify: "space-between", align: "center" }}>
        <Text style={{ color: "{color.text}", fontSize: 28 }}>Guild shop</Text>
        <Row layout={{ gap: "{space.2}", align: "center" }}>
          <Text style={{ color: "{color.gold}", fontSize: 20 }}>Gold:</Text>
          <Text bind="player.gold" style={{ color: "{color.gold}", fontSize: 20 }} />
        </Row>
      </Row>

      <List
        items="shop.items"
        as="it"
        keyPath="id"
        layout={{ width: 420, gap: "{space.2}", align: "stretch" }}
        empty={
          <Text style={{ color: "{color.muted}" }}>Nothing in stock — push `shop.items`</Text>
        }
      >
        {(it) => (
          <Row
            layout={{ height: 56, padding: "{space.2}", gap: "{space.2}", align: "center" }}
            style={{ background: "{color.surface}", radius: "{radius.md}" }}
          >
            <Column layout={{ grow: 1, gap: 2 }}>
              <Text bind={it("name")} style={{ color: "{color.text}", fontSize: 16 }} />
              <Text bind={it("detail")} style={{ color: "{color.muted}", fontSize: 13 }} />
            </Column>
            <Text bind={it("price")} style={{ color: "{color.gold}", fontSize: 15 }} />
            <Button
              variant="buy"
              onClick="buy"
              layout={{ padding: "{space.2}", justify: "center", align: "center" }}
            >
              <Text style={{ color: "{color.on-primary}", fontSize: 14 }}>Buy</Text>
            </Button>
          </Row>
        )}
      </List>

      <Text visible={{ bind: "shop.thanked" }} style={{ color: "#4ade80" }}>
        Thanks for your purchase
      </Text>
    </Column>
  );
}
```
