import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { Button, Label, renderToIR } from "./index.js";

function App() {
  return createElement(
    Button,
    {
      id: "buy-btn",
      variant: "primary",
      onClick: "buy",
      padding: { x: "space.4", y: "space.2" },
      background: "color.primary",
      radius: "radius.md",
      states: { hover: { background: "color.primary.hover" } },
    },
    createElement(Label, { color: "color.on-primary" }, "Buy"),
  );
}

describe("renderToIR", () => {
  it("convierte el árbol React en IR cruda con referencias a tokens", () => {
    expect(renderToIR(createElement(App))).toEqual({
      type: "Button",
      id: "buy-btn",
      variant: "primary",
      layout: { paddingX: "space.4", paddingY: "space.2", alignItems: "center" },
      style: {
        background: "color.primary",
        radius: "radius.md",
        states: { hover: { background: "color.primary.hover" } },
      },
      actions: { onClick: "buy" },
      children: [{ type: "Label", text: "Buy", style: { color: "color.on-primary" } }],
    });
  });
});
