import { describe, it, expect } from "vitest";
import { theme } from "./theme.js";

describe("theme", () => {
  it("expone los tokens del PoC", () => {
    expect(theme.color.primary).toBe("#4f46e5");
    expect(theme.color["primary.hover"]).toBe("#4338ca");
    expect(theme.space["4"]).toBe(16);
    expect(theme.radius.md).toBe(8);
  });
});
