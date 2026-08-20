/**
 * Reading the panel's fields (ported from `preview-client.test.ts`, ZAB-57) and
 * what the typed panel adds: an editor that knows what it edits does not have to
 * be guessed at.
 */

import { coerce, coerceTyped, show } from "@/bridge/values";

describe("coerce", () => {
  it("parses arrays and objects — a list is fed by pushing its array (ZAB-29)", () => {
    expect(coerce('[{"id":1}]')).toEqual([{ id: 1 }]);
    expect(coerce('  {"gold": 3} ')).toEqual({ gold: 3 });
  });

  it("keeps a half-written array as text instead of shouting", () => {
    expect(coerce('[{"id":')).toBe('[{"id":');
  });

  it("reads booleans and numbers as themselves", () => {
    expect(coerce("true")).toBe(true);
    expect(coerce("false")).toBe(false);
    expect(coerce("900")).toBe(900);
    expect(coerce(" 1.5 ")).toBe(1.5);
  });

  it("leaves text — including the empty string — alone", () => {
    expect(coerce("Comprar")).toBe("Comprar");
    expect(coerce("")).toBe("");
    expect(coerce("   ")).toBe("   ");
  });
});

describe("coerceTyped", () => {
  it("passes through what a typed editor already holds", () => {
    // A checkbox holds a boolean and a spinner a number: making them stringify
    // themselves so this could parse them back would invent an error case.
    expect(coerceTyped("boolean", true)).toBe(true);
    expect(coerceTyped("number", 0.5)).toBe(0.5);
  });

  it("reads a number field as a number", () => {
    expect(coerceTyped("number", "900")).toBe(900);
    expect(coerceTyped("number", " -1.5 ")).toBe(-1.5);
  });

  it("leaves a number field mid-edit as it is, instead of pushing NaN", () => {
    for (const text of ["", "-", "nope"]) {
      expect(coerceTyped("number", text), text).toBe(text);
    }
    // `"1."` is not mid-edit as far as anyone can tell: it IS one, and pushing
    // it keeps the view following the field while the decimals are typed.
    expect(coerceTyped("number", "1.")).toBe(1);
  });

  it("stops guessing on a text field — the site already said it is text", () => {
    // The word `true` in a field bound to a `Text` is the WORD true. `coerce`,
    // which has nothing but the characters to go on, would push a boolean.
    expect(coerceTyped("string", "true")).toBe("true");
    expect(coerceTyped("string", "900")).toBe("900");
    expect(coerceTyped("string", "[1,2]")).toBe("[1,2]");
  });

  it("parses the JSON of an array or object field", () => {
    expect(coerceTyped("array", '[{"id":1}]')).toEqual([{ id: 1 }]);
    expect(coerceTyped("object", ' {"gold": 3} ')).toEqual({ gold: 3 });
  });

  it("keeps a half-written array as text, like the untyped panel does", () => {
    expect(coerceTyped("array", '[{"id":')).toBe('[{"id":');
  });

  it("reads a checkbox however it reports itself", () => {
    expect(coerceTyped("boolean", "true")).toBe(true);
    expect(coerceTyped("boolean", "false")).toBe(false);
    expect(coerceTyped("boolean", 1)).toBe(true);
    expect(coerceTyped("boolean", 0)).toBe(false);
  });
});

describe("show", () => {
  it("writes a value back into a field the way it came", () => {
    expect(show(850)).toBe("850");
    expect(show(true)).toBe("true");
    expect(show("Comprar")).toBe("Comprar");
  });

  it("serializes the ones a field cannot hold as themselves", () => {
    expect(show([1, 2])).toBe("[1,2]");
    expect(show({ gold: 3 })).toBe('{"gold":3}');
    expect(show(null)).toBe("null");
  });
});
