import { describe, expect, it } from "vitest";
import { isSelected, nextChecked, slotOpacity } from "./toggle.js";

describe("slotOpacity", () => {
  it("shows children[0] only while checked", () => {
    expect(slotOpacity(0, 1)).toBe(1);
    expect(slotOpacity(0, 0)).toBe(0);
  });

  it("shows children[1] only while unchecked", () => {
    expect(slotOpacity(1, 0)).toBe(1);
    expect(slotOpacity(1, 1)).toBe(0);
  });

  it("always shows the rest (the label)", () => {
    expect(slotOpacity(2, 1)).toBe(1);
    expect(slotOpacity(2, 0)).toBe(1);
    expect(slotOpacity(7, 0.5)).toBe(1);
  });

  it("crossfades: the two indicators always add up to one", () => {
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      expect(slotOpacity(0, progress) + slotOpacity(1, progress)).toBe(1);
    }
  });

  it("settles on the endpoints, so no transition means the pre-F7 swap", () => {
    expect(slotOpacity(0, 0.5)).toBe(0.5);
    expect(slotOpacity(1, 0.5)).toBe(0.5);
  });

  it("clamps a progress outside 0..1 (and NaN) instead of painting nonsense", () => {
    expect(slotOpacity(0, 2)).toBe(1);
    expect(slotOpacity(0, -1)).toBe(0);
    expect(slotOpacity(0, Number.NaN)).toBe(0);
    expect(slotOpacity(1, Number.NaN)).toBe(1);
  });
});

describe("isSelected", () => {
  it("matches the selected value", () => {
    expect(isSelected("high", "high")).toBe(true);
    expect(isSelected("high", "low")).toBe(false);
    expect(isSelected(2, 2)).toBe(true);
  });

  it("tolerates the string/number split of the data channel", () => {
    expect(isSelected(2, "2")).toBe(true);
    expect(isSelected("2", 2)).toBe(true);
  });

  it("leaves the group empty while the value is absent", () => {
    expect(isSelected(undefined, "high")).toBe(false);
    expect(isSelected(null, "high")).toBe(false);
  });

  it("does not select options without a value", () => {
    expect(isSelected("high", undefined)).toBe(false);
    expect(isSelected(undefined, undefined)).toBe(false);
  });

  it("does not coerce non-primitives into a match", () => {
    expect(isSelected({}, {})).toBe(false);
    expect(isSelected(true, "true")).toBe(false);
  });
});

describe("nextChecked", () => {
  it("flips a standalone toggle", () => {
    expect(nextChecked(false, false)).toBe(true);
    expect(nextChecked(true, false)).toBe(false);
  });

  it("never empties an exclusive-check group: a radio only turns on", () => {
    expect(nextChecked(false, true)).toBe(true);
    expect(nextChecked(true, true)).toBe(true);
  });
});
