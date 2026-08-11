import { describe, expect, it } from "vitest";
import { closedHeight, collapseTarget } from "./collapse.js";

describe("closedHeight", () => {
  it("is the header inside the node's own padding", () => {
    expect(closedHeight(24, 8)).toBe(40);
  });

  it("is just the padding when there is no header to show", () => {
    expect(closedHeight(0, 8)).toBe(16);
  });

  it("never goes negative on nonsense input", () => {
    expect(closedHeight(-10, 0)).toBe(0);
    expect(closedHeight(20, -4)).toBe(20);
  });
});

describe("collapseTarget", () => {
  it("aims at the header's box while closing", () => {
    expect(collapseTarget(false, 200, 40)).toBe(40);
  });

  it("aims at the height measured with the content in while opening", () => {
    expect(collapseTarget(true, 200, 40)).toBe(200);
  });

  it("holds shut the frame the content enters layout — the open height is not measured yet", () => {
    // That frame the natural height is still the closed box, so opening lands on
    // it: the Collapse stays closed for one frame instead of popping open, and
    // the tween starts on the next one with the height this frame measured.
    expect(collapseTarget(true, 40, 40)).toBe(40);
  });

  it("never opens smaller than its own header", () => {
    expect(collapseTarget(true, 10, 40)).toBe(40);
  });
});
