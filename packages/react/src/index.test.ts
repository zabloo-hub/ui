import type {
  ContainerNode,
  ProgressBarNode,
  RepeatNode,
  SliderNode,
  SpinnerNode,
  ToggleNode,
} from "@zabloo/format";
import { Fragment, createElement as h, useState } from "react";
import { describe, expect, it } from "vitest";
import {
  Accordion,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Column,
  Container,
  Grid,
  Image,
  List,
  ProgressBar,
  Radio,
  RadioGroup,
  Row,
  renderToIR,
  ScrollView,
  Slider,
  Spinner,
  Switch,
  Tab,
  Tabs,
  Text,
  ThemeProvider,
  type ZablooTheme,
} from "./index.js";

describe("renderToIR", () => {
  it("emits the vertical-slice Button tree", () => {
    // <Button onClick="buy"><Text>Comprar</Text></Button>
    const ir = renderToIR(
      h(
        Button,
        {
          onClick: "buy",
          style: { background: "{color.primary}", radius: "{radius.md}" },
          states: { pressed: { style: { background: "{color.primary.hover}" } } },
        },
        h(Text, { style: { color: "{color.on-primary}" } }, "Comprar"),
      ),
    );

    expect(ir).toEqual({
      type: "Button",
      onClick: "buy",
      style: { background: "{color.primary}", radius: "{radius.md}" },
      states: { pressed: { style: { background: "{color.primary.hover}" } } },
      children: [{ type: "Text", style: { color: "{color.on-primary}" }, text: "Comprar" }],
    });
  });

  it("executes user components at authoring time — they never reach the IR", () => {
    function FancyLabel({ label }: { label: string }) {
      return h(Text, null, label.toUpperCase());
    }
    const ir = renderToIR(h(Container, null, h(FancyLabel, { label: "hi" })));
    expect(ir).toEqual({
      type: "Container",
      children: [{ type: "Text", text: "HI" }],
    });
  });

  it("supports hooks in user components", () => {
    function WithState() {
      const [label] = useState("from-state");
      return h(Text, null, label);
    }
    expect(renderToIR(h(WithState))).toEqual({ type: "Text", text: "from-state" });
  });

  it("lowers Row/Column sugar to Container with direction", () => {
    const ir = renderToIR(h(Row, { layout: { gap: 8 } }, h(Column, null, h(Text, null, "x"))));
    expect(ir).toEqual({
      type: "Container",
      layout: { direction: "row", gap: 8 },
      children: [
        {
          type: "Container",
          layout: { direction: "column" },
          children: [{ type: "Text", text: "x" }],
        },
      ],
    });
  });

  it("serializes Collapse (header = first child, content = rest)", () => {
    const ir = renderToIR(
      h(
        Collapse,
        { id: "options", open: false },
        h(Text, null, "Opciones"),
        h(Text, null, "Sonido: alto"),
      ),
    );
    expect(ir).toEqual({
      type: "Collapse",
      id: "options",
      open: false,
      children: [
        { type: "Text", text: "Opciones" },
        { type: "Text", text: "Sonido: alto" },
      ],
    });
  });

  it("rejects Collapse without header + content", () => {
    expect(() => renderToIR(h(Collapse, null, h(Text, null, "solo header")))).toThrow(
      /header .* and one content child/,
    );
  });

  it("flattens Accordion to Container + group (composites never reach the IR)", () => {
    const ir = renderToIR(
      h(
        Accordion,
        { layout: { gap: 4 } },
        h(Collapse, { id: "a", open: true }, h(Text, null, "A"), h(Text, null, "a1")),
        h(Collapse, { id: "b", open: false }, h(Text, null, "B"), h(Text, null, "b1")),
      ),
    );
    expect(ir).toEqual({
      type: "Container",
      group: "exclusive-open",
      layout: { direction: "column", gap: 4 },
      children: [
        {
          type: "Collapse",
          id: "a",
          open: true,
          children: [
            { type: "Text", text: "A" },
            { type: "Text", text: "a1" },
          ],
        },
        {
          type: "Collapse",
          id: "b",
          open: false,
          children: [
            { type: "Text", text: "B" },
            { type: "Text", text: "b1" },
          ],
        },
      ],
    });
  });

  it("serializes ScrollView (axis, scrollbar, children)", () => {
    const ir = renderToIR(
      h(
        ScrollView,
        { id: "inventory", axis: "vertical", scrollbar: false, layout: { height: 200 } },
        h(Text, null, "Item 1"),
        h(Text, null, "Item 2"),
      ),
    );
    expect(ir).toEqual({
      type: "ScrollView",
      id: "inventory",
      axis: "vertical",
      scrollbar: false,
      layout: { height: 200 },
      children: [
        { type: "Text", text: "Item 1" },
        { type: "Text", text: "Item 2" },
      ],
    });
  });

  it("serializes Image with the authoring path — the export rewrites it to asset:", () => {
    const ir = renderToIR(
      h(Image, {
        id: "hero",
        src: "art/hero.png",
        fit: "cover",
        // Tint and placeholder are plain style: no Image-specific props.
        style: { color: "{color.gold}", background: "{color.surface}", radius: 12 },
        layout: { width: 240, height: 120 },
      }),
    );
    expect(ir).toEqual({
      type: "Image",
      id: "hero",
      src: "art/hero.png",
      fit: "cover",
      style: { color: "{color.gold}", background: "{color.surface}", radius: 12 },
      layout: { width: 240, height: 120 },
    });
  });

  it("omits fit when the default (contain) is good enough", () => {
    expect(renderToIR(h(Image, { src: "logo.png" }))).toEqual({
      type: "Image",
      src: "logo.png",
    });
  });

  it("rejects an Image without a src", () => {
    expect(() => renderToIR(h(Image, { src: "" }))).toThrow(/needs a `src` path/);
  });

  it("rejects an Image with children — it is a leaf", () => {
    expect(() => renderToIR(h(Image, { src: "logo.png" }, h(Text, null, "x")))).toThrow(
      /takes no children/,
    );
  });

  it("lowers Checkbox to a Toggle with both indicator slots", () => {
    const ir = renderToIR(
      h(
        Checkbox,
        { id: "sfx", checked: { bind: "settings.sfx" }, onChange: "sfx-changed", size: 20 },
        h(Text, null, "Efectos"),
      ),
    );
    expect(ir).toEqual({
      type: "Toggle",
      id: "sfx",
      checked: { bind: "settings.sfx" },
      onChange: "sfx-changed",
      layout: { direction: "row", align: "center", gap: 10 },
      children: [
        // children[0] — the whole indicator as it looks CHECKED (box + mark).
        {
          type: "Container",
          layout: { width: 20, height: 20, justify: "center", align: "center" },
          style: {
            borderWidth: 2,
            borderColor: "#4f46e5",
            radius: 4,
            background: "#4f46e5",
          },
          children: [
            {
              type: "Container",
              layout: { width: 9, height: 9 },
              style: { background: "#ffffff", radius: 2 },
            },
          ],
        },
        // children[1] — UNCHECKED: the empty box.
        {
          type: "Container",
          layout: { width: 20, height: 20, justify: "center", align: "center" },
          style: { borderWidth: 2, borderColor: "#8b93a8", radius: 4 },
        },
        // children[2..] — always shown.
        { type: "Text", text: "Efectos" },
      ],
    });
  });

  it("moves the Switch knob by justifying each slot to a different end", () => {
    const ir = renderToIR(h(Switch, { checked: true })) as ToggleNode;
    const [on, off] = (ir.children ?? []) as ContainerNode[];
    expect(ir.checked).toBe(true);
    expect(on.layout?.justify).toBe("end");
    expect(off.layout?.justify).toBe("start");
    // Same knob, different rail — only the track color tells the states apart.
    expect(on.children?.[0]).toEqual(off.children?.[0]);
    expect(on.style?.background).toBe("#4f46e5");
    expect(off.style?.background).toBe("#2f3446");
  });

  it("flattens RadioGroup to Container + exclusive-check + one value per option", () => {
    const ir = renderToIR(
      h(
        RadioGroup,
        { value: { bind: "settings.quality" }, layout: { gap: 6 } },
        h(Radio, { value: "low" }, h(Text, null, "Baja")),
        h(Radio, { value: "high" }, h(Text, null, "Alta")),
      ),
    ) as ContainerNode;
    expect(ir.type).toBe("Container");
    expect(ir.group).toBe("exclusive-check");
    expect(ir.value).toEqual({ bind: "settings.quality" });
    expect(ir.layout).toEqual({ direction: "column", gap: 6 });
    const options = (ir.children ?? []) as ToggleNode[];
    expect(options.map((o) => o.value)).toEqual(["low", "high"]);
    // Round box: radius = half the size, on both slots.
    const [checkedSlot] = (options[0].children ?? []) as ContainerNode[];
    expect(checkedSlot.style?.radius).toBe(11);
  });

  it("lowers Slider to a rail plus its two value-driven slots", () => {
    const ir = renderToIR(
      h(Slider, {
        id: "volume",
        value: { bind: "settings.volume" },
        step: 0.05,
        onChange: "volume-preview",
        onCommit: "volume-apply",
        length: 240,
      }),
    );
    expect(ir).toEqual({
      type: "Slider",
      id: "volume",
      value: { bind: "settings.volume" },
      step: 0.05,
      onChange: "volume-preview",
      onCommit: "volume-apply",
      // The node IS the rail: its own style paints the track.
      layout: { width: 240, height: 6 },
      style: { radius: 3, background: "#2f3446" },
      children: [
        // children[0] — the fill: no size along the axis, the SDK sets it.
        { type: "Container", layout: { height: 6 }, style: { radius: 3, background: "#4f46e5" } },
        // children[1] — the thumb, fatter than the rail it rides.
        {
          type: "Container",
          layout: { width: 18, height: 18 },
          style: { radius: 9, background: "#ffffff" },
        },
      ],
    });
  });

  it("turns a vertical Slider's rail on its side", () => {
    const ir = renderToIR(
      h(Slider, { axis: "vertical", length: 120, thickness: 8, min: 0, max: 100, step: 10 }),
    ) as SliderNode;
    expect(ir.axis).toBe("vertical");
    expect(ir.layout).toEqual({ height: 120, width: 8 });
    const [fill] = (ir.children ?? []) as ContainerNode[];
    expect(fill.layout).toEqual({ width: 8 });
    expect([ir.min, ir.max, ir.step]).toEqual([0, 100, 10]);
  });

  it("rejects a Slider range that cannot be dragged", () => {
    expect(() => renderToIR(h(Slider, { min: 10, max: 2 }))).toThrow(/max > min/);
  });

  it("rejects binding a Radio value (the selection is bound on the group)", () => {
    expect(() =>
      // @ts-expect-error — a Radio value is static by type; this pins the runtime guard too
      renderToIR(h(RadioGroup, null, h(Radio, { value: { bind: "settings.quality" } }))),
    ).toThrow(/value is static/);
  });

  it("serializes Text bindings", () => {
    expect(renderToIR(h(Text, { bind: "player.gold" }))).toEqual({
      type: "Text",
      text: { bind: "player.gold" },
    });
  });

  it("joins mixed text children", () => {
    expect(renderToIR(h(Text, null, "Gold: ", 42))).toEqual({ type: "Text", text: "Gold: 42" });
  });

  it("resolves variants at authoring time — they never reach the IR", () => {
    const theme: ZablooTheme = {
      variants: {
        Button: {
          primary: {
            style: { background: "{color.primary}", radius: "{radius.md}" },
            states: { pressed: { style: { background: "{color.primary.hover}" } } },
          },
        },
      },
    };
    const ir = renderToIR(
      h(
        ThemeProvider,
        { theme },
        h(
          Button,
          { variant: "primary", style: { radius: 99 }, onClick: "buy" },
          h(Text, null, "x"),
        ),
      ),
    );
    expect(ir).toEqual({
      type: "Button",
      onClick: "buy",
      // variant style merged UNDER explicit props (radius 99 wins); no `variant` field.
      style: { background: "{color.primary}", radius: 99 },
      states: { pressed: { style: { background: "{color.primary.hover}" } } },
      children: [{ type: "Text", text: "x" }],
    });
  });

  it("fails loudly on unknown variants", () => {
    const theme: ZablooTheme = { variants: { Button: { primary: {} } } };
    expect(() =>
      renderToIR(h(ThemeProvider, { theme }, h(Button, { variant: "ghost" }, h(Text, null, "x")))),
    ).toThrow(/Unknown Button variant "ghost".*primary/);
  });

  it("serializes autofocus", () => {
    expect(renderToIR(h(Button, { autofocus: true, onClick: "a" }, h(Text, null, "x")))).toEqual({
      type: "Button",
      autofocus: true,
      onClick: "a",
      children: [{ type: "Text", text: "x" }],
    });
  });

  it("serializes clip (overflow: hidden on any node)", () => {
    expect(renderToIR(h(Container, { clip: true }, h(Text, null, "x")))).toEqual({
      type: "Container",
      clip: true,
      children: [{ type: "Text", text: "x" }],
    });
  });

  it("serializes transition, tokenized duration included", () => {
    expect(
      renderToIR(
        h(
          Button,
          { transition: { duration: "{motion.fast}", easing: "ease-out" }, onClick: "a" },
          h(Text, null, "x"),
        ),
      ),
    ).toEqual({
      type: "Button",
      transition: { duration: "{motion.fast}", easing: "ease-out" },
      onClick: "a",
      children: [{ type: "Text", text: "x" }],
    });
  });

  it("omits transition when the node declares none — pre-F7 output is unchanged", () => {
    expect(renderToIR(h(Container, { style: { opacity: 0.5 } }))).toEqual({
      type: "Container",
      style: { opacity: 0.5 },
    });
  });

  it("flattens Tabs to bar + panels (positional contract, no id wiring)", () => {
    const ir = renderToIR(
      h(
        Tabs,
        { selected: 1, bar: { layout: { gap: 8 } } },
        h(Tab, { key: "video", id: "tab-video", label: "Video" }, h(Text, null, "resolución")),
        h(
          Tab,
          {
            key: "audio",
            label: h(Text, { style: { color: "#fff" } }, "Audio"),
            panel: { id: "audio-panel" },
          },
          h(Text, null, "volumen"),
        ),
      ),
    );

    expect(ir).toEqual({
      type: "Container",
      group: "exclusive-select",
      selected: 1,
      layout: { direction: "column" },
      children: [
        {
          type: "Container",
          layout: { direction: "row", gap: 8 },
          children: [
            { type: "Button", id: "tab-video", children: [{ type: "Text", text: "Video" }] },
            {
              type: "Button",
              children: [{ type: "Text", style: { color: "#fff" }, text: "Audio" }],
            },
          ],
        },
        { type: "Container", children: [{ type: "Text", text: "resolución" }] },
        { type: "Container", id: "audio-panel", children: [{ type: "Text", text: "volumen" }] },
      ],
    });
  });

  it("omits selected when the first tab is the default one", () => {
    const ir = renderToIR(h(Tabs, null, h(Tab, { label: "Only" }, h(Text, null, "panel")))) as {
      selected?: number;
    };
    expect(ir.selected).toBeUndefined();
  });

  it("rejects a Tabs whose children are not Tabs", () => {
    expect(() => renderToIR(h(Tabs, null, h(Container, null)))).toThrow(/must all be <Tab>/);
  });

  it("rejects an empty Tabs", () => {
    expect(() => renderToIR(h(Tabs, null))).toThrow(/at least one <Tab>/);
  });

  it("rejects a selected index outside the tab range", () => {
    expect(() =>
      renderToIR(h(Tabs, { selected: 2 }, h(Tab, { label: "A" }, h(Text, null, "a")))),
    ).toThrow(/out of range/);
  });

  it("rejects a <Tab> rendered outside a <Tabs>", () => {
    expect(() => renderToIR(h(Tab, { label: "A" }, h(Text, null, "a")))).toThrow(
      /direct child of <Tabs>/,
    );
  });

  it("builds a ProgressBar: the node is the track, children[0] is the fill", () => {
    expect(
      renderToIR(
        h(ProgressBar, {
          value: { bind: "player.hp" },
          transition: { duration: "{motion.fast}" },
          layout: { width: 200 },
          style: { background: "#1f2430" },
          fill: { background: "#22c55e" },
        }),
      ),
    ).toEqual({
      type: "ProgressBar",
      value: { bind: "player.hp" },
      transition: { duration: "{motion.fast}" },
      // Clips by default so a square fill stays inside the rounded track.
      clip: true,
      layout: { direction: "row", height: 8, width: 200 },
      style: { background: "#1f2430", radius: 4 },
      children: [{ type: "Container", style: { background: "#22c55e", radius: 4 } }],
    });
  });

  it("sizes a column ProgressBar across instead of down", () => {
    const ir = renderToIR(
      h(ProgressBar, { value: 0.5, size: 12, layout: { direction: "column", height: 80 } }),
    ) as ProgressBarNode;
    expect(ir.layout).toEqual({ direction: "column", width: 12, height: 80 });
    expect(ir.value).toBe(0.5);
  });

  it("rejects a hand-built ProgressBar without exactly one fill", () => {
    // The primitive's slot is positional, so a bare track is an authoring error.
    expect(() => renderToIR(h("ProgressBar", { value: 0.5 }))).toThrow(/exactly one child/);
    expect(() =>
      renderToIR(
        h("ProgressBar", { value: 0.5 }, h(Container, { key: "a" }), h(Container, { key: "b" })),
      ),
    ).toThrow(/exactly one child/);
  });

  it("builds a Spinner with its beads and passes the loop knobs through", () => {
    expect(
      renderToIR(h(Spinner, { dots: 2, size: 10, period: "{motion.loop}", min: 0.2 })),
    ).toEqual({
      type: "Spinner",
      period: "{motion.loop}",
      min: 0.2,
      layout: { direction: "row", align: "center", gap: 8 },
      children: [
        {
          type: "Container",
          layout: { width: 10, height: 10 },
          style: { radius: 5, background: "#c8cede" },
        },
        {
          type: "Container",
          layout: { width: 10, height: 10 },
          style: { radius: 5, background: "#c8cede" },
        },
      ],
    });
  });

  it("takes custom beads instead of the generated dots", () => {
    const ir = renderToIR(
      h(Spinner, null, h(Text, { key: "a" }, "."), h(Text, { key: "b" }, ".")),
    ) as SpinnerNode;
    expect(ir.children).toEqual([
      { type: "Text", text: "." },
      { type: "Text", text: "." },
    ]);
  });

  it("rejects a Spinner with no beads to pulse", () => {
    expect(() => renderToIR(h("Spinner", { period: 900 }))).toThrow(/at least one child/);
  });

  it("flattens Badge to a pill Container plus a bound Text — no IR of its own", () => {
    expect(renderToIR(h(Badge, { count: { bind: "inbox.unread" } }))).toEqual({
      type: "Container",
      layout: { direction: "row", justify: "center", align: "center", padding: 4 },
      style: { radius: 999, background: "#ef4444" },
      children: [
        { type: "Text", text: { bind: "inbox.unread" }, style: { color: "#ffffff", fontSize: 12 } },
      ],
    });
  });

  it("takes a static count and custom label styling", () => {
    const ir = renderToIR(
      h(Badge, { count: 9, label: { fontSize: 16 }, style: { background: "#4f46e5" } }),
    ) as ContainerNode;
    expect(ir.style).toEqual({ radius: 999, background: "#4f46e5" });
    expect(ir.children?.[0]).toEqual({
      type: "Text",
      text: "9",
      style: { color: "#ffffff", fontSize: 16 },
    });
  });

  it("emits a List as a Repeat: template in children[0], empty state after it", () => {
    const ir = renderToIR(
      h(
        List,
        {
          items: "shop.items",
          as: "it",
          keyPath: "id",
          layout: { gap: 8 },
          empty: h(Text, null, "Nada por aquí"),
        },
        h(
          Row,
          { layout: { gap: 12, align: "center" } },
          h(Text, { key: "name", bind: "it.name" }),
          h(Text, { key: "price", bind: "it.price.amount" }),
          h(Button, { key: "buy", onClick: "buy" }, h(Text, null, "Comprar")),
        ),
      ),
    );

    expect(ir).toEqual({
      type: "Repeat",
      items: { bind: "shop.items" },
      as: "it",
      key: "id",
      layout: { direction: "column", gap: 8 },
      children: [
        {
          type: "Container",
          layout: { direction: "row", gap: 12, align: "center" },
          children: [
            { type: "Text", text: { bind: "it.name" } },
            { type: "Text", text: { bind: "it.price.amount" } },
            { type: "Button", onClick: "buy", children: [{ type: "Text", text: "Comprar" }] },
          ],
        },
        { type: "Text", text: "Nada por aquí" },
      ],
    });
  });

  it("lays a horizontal List out as a row", () => {
    const ir = renderToIR(
      h(List, { items: "shop.items", axis: "horizontal" }, h(Text, { bind: "item.name" })),
    ) as RepeatNode;
    expect(ir.layout).toEqual({ direction: "row" });
  });

  it("flattens user components inside the template, like everywhere else", () => {
    function Price({ path }: { path: string }) {
      return h(Text, { style: { color: "#22c55e" }, bind: path });
    }
    const ir = renderToIR(
      h(List, { items: "shop.items" }, h(Price, { path: "item.price" })),
    ) as RepeatNode;
    expect(ir.children).toEqual([
      { type: "Text", style: { color: "#22c55e" }, text: { bind: "item.price" } },
    ]);
  });

  it("takes several nodes as the empty state — children[1..] is the whole slot", () => {
    const ir = renderToIR(
      h(
        List,
        {
          items: "inbox.messages",
          empty: [h(Text, { key: "t" }, "Bandeja vacía"), h(Text, { key: "s" }, "Vuelve luego")],
        },
        h(Text, { bind: "item.subject" }),
      ),
    ) as RepeatNode;
    expect(ir.children?.slice(1)).toEqual([
      { type: "Text", text: "Bandeja vacía" },
      { type: "Text", text: "Vuelve luego" },
    ]);
  });

  it("omits `as` and `key` when the list takes the defaults", () => {
    const ir = renderToIR(h(List, { items: "a.b" }, h(Text, { bind: "item.c" }))) as RepeatNode;
    expect(ir.as).toBeUndefined();
    expect(ir.key).toBeUndefined();
  });

  it("solves the cell width from layout.width, discounting gaps and padding", () => {
    const ir = renderToIR(
      h(
        Grid,
        {
          items: "inventory.slots",
          columns: 3,
          cell: { style: { background: "#1f2430" } },
          layout: { width: 300, gap: 10, padding: 5 },
        },
        h(Text, { bind: "item.name" }),
      ),
    ) as RepeatNode;

    expect(ir.layout).toEqual({ direction: "row", wrap: true, width: 300, gap: 10, padding: 5 });
    // (300 - 2*10 - 2*5) / 3
    expect(ir.children?.[0]).toEqual({
      type: "Container",
      layout: { width: 90 },
      style: { background: "#1f2430" },
      children: [{ type: "Text", text: { bind: "item.name" } }],
    });
  });

  it("floors an inexact cell width so the cells never overflow their line", () => {
    const ir = renderToIR(
      h(Grid, { items: "a", columns: 3, layout: { width: 100 } }, h(Text, { bind: "item.b" })),
    ) as RepeatNode;
    const cell = ir.children?.[0] as ContainerNode;
    expect(cell.layout?.width).toBe(33);
  });

  it("keeps several template nodes inside the Grid's own cell", () => {
    const ir = renderToIR(
      h(
        Grid,
        { items: "a", columns: 2, itemWidth: 50 },
        h(Text, { key: "n", bind: "item.name" }),
        h(Text, { key: "p", bind: "item.price" }),
      ),
    ) as RepeatNode;
    expect(ir.children).toHaveLength(1);
    const cell = ir.children?.[0] as ContainerNode | undefined;
    expect(cell?.children).toHaveLength(2);
  });

  it("rejects a Grid it cannot resolve the geometry of", () => {
    expect(() =>
      renderToIR(h(Grid, { items: "a", columns: 3 }, h(Text, { bind: "item.b" }))),
    ).toThrow(/pass `itemWidth`, or a numeric `layout.width`/);
    expect(() =>
      renderToIR(h(Grid, { items: "a", columns: 0, itemWidth: 10 }, h(Text, { bind: "item.b" }))),
    ).toThrow(/integer >= 1/);
    expect(() =>
      renderToIR(
        h(Grid, { items: "a", columns: 5, layout: { width: 20, gap: 10 } }, h(Text, { bind: "b" })),
      ),
    ).toThrow(/does not fit/);
  });

  it("rejects a tokenized gap on a Grid — the cell width is arithmetic, done here", () => {
    expect(() =>
      renderToIR(
        h(
          Grid,
          { items: "a", columns: 3, itemWidth: 40, layout: { gap: "{space.2}" } },
          h(Text, { bind: "item.b" }),
        ),
      ),
    ).toThrow(/layout.gap must be a number of px/);
  });

  it("rejects a list template that is not a single node", () => {
    expect(() => renderToIR(h(List, { items: "a" }))).toThrow(/needs an item template/);
    expect(() =>
      renderToIR(
        h(List, { items: "a" }, h(Text, { key: "a", bind: "item.a" }), h(Text, { key: "b" }, "b")),
      ),
    ).toThrow(/single node/);
    expect(() =>
      renderToIR(h(List, { items: "a" }, h(Fragment, null, h(Text, { key: "a", bind: "item.a" })))),
    ).toThrow(/single node/);
  });

  it("rejects a hand-built Repeat without an items path or without a template", () => {
    expect(() => renderToIR(h("Repeat", null, h(Text, { bind: "item.a" })))).toThrow(
      /need an `items` data path/,
    );
    expect(() => renderToIR(h("Repeat", { items: "a" }))).toThrow(/need an item template/);
  });

  it("rejects raw text outside <Text>", () => {
    expect(() => renderToIR(h(Container, null, "loose"))).toThrow(/wrapped in <Text>/);
  });

  it("rejects non-primitive host types", () => {
    expect(() => renderToIR(h("div", null))).toThrow(/not a zabloo primitive/);
  });

  it("rejects multiple roots", () => {
    expect(() => renderToIR([h(Text, { key: "a" }, "a"), h(Text, { key: "b" }, "b")])).toThrow(
      /exactly one root/,
    );
  });
});
