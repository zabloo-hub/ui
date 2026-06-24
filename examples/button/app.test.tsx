import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToIR } from "@zabloo/react";
import { resolve, buildDocument, theme } from "@zabloo/core";
import App from "./app.js";

describe("example button end-to-end", () => {
  it("authoring → IR resuelta coincide con el documento esperado", () => {
    const doc = buildDocument(resolve(renderToIR(createElement(App)), theme));
    expect(doc).toEqual({
      version: "0.0.1-poc",
      root: {
        type: "Button",
        id: "buy-btn",
        variant: "primary",
        layout: { paddingX: 16, paddingY: 8, alignItems: "center" },
        style: { background: "#4f46e5", radius: 8, states: { hover: { background: "#4338ca" } } },
        actions: { onClick: "buy" },
        children: [{ type: "Label", text: "Buy", style: { color: "#ffffff" } }],
      },
    });
  });
});
