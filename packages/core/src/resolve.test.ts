import { describe, it, expect } from "vitest";
import { resolve, token, buildDocument } from "./index.js";
import { theme } from "./theme.js";
import type { RawIRButton } from "./types.js";

const rawButton: RawIRButton = {
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
};

describe("token", () => {
  it("resuelve referencias a su valor concreto", () => {
    expect(token("color.primary", theme)).toBe("#4f46e5");
    expect(token("space.4", theme)).toBe(16);
    expect(token("color.primary.hover", theme)).toBe("#4338ca");
  });
  it("lanza error claro con un token inexistente", () => {
    expect(() => token("color.nope", theme)).toThrow("Unknown token: color.nope");
  });
});

describe("resolve", () => {
  it("baja tokens a valores concretos por nodo", () => {
    expect(resolve(rawButton, theme)).toEqual({
      type: "Button",
      id: "buy-btn",
      variant: "primary",
      layout: { paddingX: 16, paddingY: 8, alignItems: "center" },
      style: {
        background: "#4f46e5",
        radius: 8,
        states: { hover: { background: "#4338ca" } },
      },
      actions: { onClick: "buy" },
      children: [{ type: "Label", text: "Buy", style: { color: "#ffffff" } }],
    });
  });
});

describe("buildDocument", () => {
  it("envuelve la raíz con la versión del PoC", () => {
    const doc = buildDocument(resolve(rawButton, theme));
    expect(doc.version).toBe("0.0.1-poc");
    expect(doc.root.type).toBe("Button");
  });
});
