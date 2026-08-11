import { describe, expect, it } from "vitest";
import { isSelected, nextChecked, slotShown } from "./toggle.js";

describe("slotShown", () => {
  it("shows children[0] only while checked", () => {
    expect(slotShown(0, true)).toBe(true);
    expect(slotShown(0, false)).toBe(false);
  });

  it("shows children[1] only while unchecked", () => {
    expect(slotShown(1, false)).toBe(true);
    expect(slotShown(1, true)).toBe(false);
  });

  it("always shows the rest (the label)", () => {
    expect(slotShown(2, true)).toBe(true);
    expect(slotShown(2, false)).toBe(true);
    expect(slotShown(7, false)).toBe(true);
  });

  it("never shows both indicator slots at once", () => {
    for (const checked of [true, false]) {
      expect(slotShown(0, checked)).not.toBe(slotShown(1, checked));
    }
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
