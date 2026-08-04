import { createElement as h, useState } from "react";
import { describe, expect, it } from "vitest";
import {
  Accordion,
  Button,
  Collapse,
  Column,
  Container,
  Row,
  renderToIR,
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
