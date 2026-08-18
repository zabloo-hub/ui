# @zabloo/react

> Author your game's UI in React. The JSX doesn't render to the DOM — it emits the
> [zabloo IR](https://github.com/zabloo-hub/ui/blob/main/docs/README.md), which an
> in-engine SDK draws itself.

Part of [zabloo/ui](https://github.com/zabloo-hub/ui) — build the UI once, render it
identically in Unity, Godot or Unreal.

React drives a custom reconciler (the react-three-fiber model: React owns the tree,
nothing touches the DOM). Your own components run at **authoring time** and never reach
the IR: what the SDK receives is always a tree of documented node types.

## Install

```bash
npm install @zabloo/react react
```

Most projects don't call this package directly — `create-zabloo-app` scaffolds a project
where `zabloo export` does it for you, one view per file in `src/views/`.

## A view

```tsx
import { Button, Collapse, Column, Row, Switch, Text } from "@zabloo/react";

export default function MainMenu() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: 16 }}>
      <Row layout={{ gap: 12 }}>
        <Button variant="primary" autofocus onClick="play" layout={{ padding: "{space.4}" }}>
          <Text style={{ color: "{color.on-primary}", fontSize: 24 }}>Play</Text>
        </Button>
        <Button variant="secondary" onClick="quit" layout={{ padding: "{space.4}" }}>
          <Text style={{ color: "{color.text}", fontSize: 24 }}>Quit</Text>
        </Button>
      </Row>

      <Collapse id="options" open={false} layout={{ padding: "{space.2}", gap: 8 }}>
        <Text style={{ color: "{color.text}" }}>Options</Text>
        <Switch checked={{ bind: "settings.sfx" }} onChange="sfx-changed">
          <Text style={{ color: "{color.muted}" }}>Sound</Text>
        </Switch>
      </Collapse>

      <Row layout={{ gap: 8 }}>
        <Text style={{ color: "{color.gold}" }}>Gold:</Text>
        <Text bind="player.gold" style={{ color: "{color.gold}" }} />
      </Row>
    </Column>
  );
}
```

Two things cross into the running game, and only these two: **named actions**
(`onClick="play"` surfaces as a C# event / signal / Blueprint) and **data-path bindings**
(`bind="player.gold"`, or `{ bind: "…" }` on any bindable prop) which re-lay out live
when the game calls `SetData`. There are no callbacks in the IR — a closure can't be
serialized into an envelope.

`"{color.primary}"` is a **token reference**, resolved by the SDK against the envelope's
flat dictionary, so a theme can hot-update without re-emitting the tree. `variant`, in
contrast, is resolved at export time against the project's theme (see `ThemeProvider`
below) — it never reaches the IR, and an unknown one fails the export loudly.

## Emitting the IR yourself

```ts
import { renderToIR, ThemeProvider } from "@zabloo/react";
import { createElement } from "react";
import { theme } from "./theme.js";

const node = renderToIR(createElement(ThemeProvider, { theme }, createElement(MainMenu)));
```

One-shot: it mounts synchronously, serializes the tree and unmounts. The element must
resolve to exactly one root node — wrap several in a `Container`.

## What's in the box

The IR has a closed set of **13 node types**. Seven of them have a component that emits
exactly that node and nothing else: `Container`, `Text`, `Button`, `Collapse`,
`ScrollView`, `Image`, `Overlay`.

Four more come with their children already built, so you never write the slots by hand:
`Slider` emits the node plus its fill and thumb, `ProgressBar` plus its fill, `Spinner`
plus its beads, and `TextInput` — a leaf, so it only carries the field's defaults. The
remaining two node types have no component of their own name at all: a `Toggle` is authored
as `Checkbox`, `Switch`, `Radio` or `Option`, and a `Repeat` as `List` or `Grid`.

Everything else is an authoring-time **composite** that flattens to those nodes before the
export: `Row`/`Column`, `Accordion`, `Tabs`/`Tab`, `Checkbox`/`Switch`/`Radio`/`RadioGroup`,
`Select`/`Option`, `Badge`, `Modal`/`Toast`/`Tooltip`, and `List`/`Grid`, which emit a
`Repeat` node so a bound array renders one item per element without the tree knowing how
many there are.

`ThemeProvider` supplies the project's variants (resolved at export time — they never
reach the IR) and the default per-component `transition`.

## Documentation

- [Component catalog](https://github.com/zabloo-hub/ui/blob/main/docs/components/README.md) — one page per node type, with the components that emit it.
- [Bindings & actions](https://github.com/zabloo-hub/ui/blob/main/docs/format/bindings.md) · [Layout](https://github.com/zabloo-hub/ui/blob/main/docs/format/layout.md) · [Style](https://github.com/zabloo-hub/ui/blob/main/docs/format/style.md) · [Motion](https://github.com/zabloo-hub/ui/blob/main/docs/format/motion.md)
- [Full documentation](https://github.com/zabloo-hub/ui/blob/main/docs/README.md)

## License

MIT
