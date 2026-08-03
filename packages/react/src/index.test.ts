import { createElement as h, useState } from "react";
import { describe, expect, it } from "vitest";
import { Button, Column, Container, Row, renderToIR, Text } from "./index.js";

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

  it("serializes Text bindings", () => {
    expect(renderToIR(h(Text, { bind: "player.gold" }))).toEqual({
      type: "Text",
      text: { bind: "player.gold" },
    });
  });

  it("joins mixed text children", () => {
    expect(renderToIR(h(Text, null, "Gold: ", 42))).toEqual({ type: "Text", text: "Gold: 42" });
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
