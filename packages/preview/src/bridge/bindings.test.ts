/**
 * The binding walk (ported from `preview-client.test.ts`, ZAB-57) plus what V5
 * adds to it: the type each path is edited as.
 *
 * The walk's own cases are the ones that were already covered, and they are here
 * verbatim on purpose — this is a COPY of live logic, and the port is only honest
 * if it keeps answering the same things. The `Repeat` rule is the one to watch:
 * a template's paths are addresses into an array, not values anyone pushes.
 */

import type { Envelope } from "@zabloo/format";
import { type Binding, collectBindings } from "@/bridge/bindings";

const GOLD: Envelope = {
  v: 1,
  tokens: {},
  views: {
    main: {
      type: "Container",
      children: [{ type: "Text", text: { bind: "player.gold" } }],
    },
  },
};

/** The walk's answer as the panel reads it: path → type. */
function typed(node: unknown): Record<string, string> {
  return Object.fromEntries(collectBindings(node).map((b: Binding) => [b.path, b.type]));
}

function paths(node: unknown): string[] {
  return collectBindings(node).map((binding) => binding.path);
}

describe("collectBindings", () => {
  it("finds every bound path in the tree", () => {
    expect(paths(GOLD)).toEqual(["player.gold"]);
  });

  it("skips the paths of a Repeat template, which are relative to the item", () => {
    const found = paths({
      type: "Repeat",
      items: { bind: "shop.items" },
      children: [
        { type: "Text", text: { bind: "item.name" } },
        { type: "Text", text: { bind: "shop.emptyMessage" } },
      ],
    });

    // The array and the empty state are values the game pushes; "item.name" is
    // an address INTO the array, and nobody can push it.
    expect(found).toEqual(["shop.emptyMessage", "shop.items"]);
  });

  it("still collects the Repeat's own bindings", () => {
    const found = paths({
      type: "Repeat",
      items: { bind: "shop.items" },
      visible: { bind: "shop.open" },
      children: [{ type: "Text", text: { bind: "item.name" } }],
    });

    expect(found).toEqual(["shop.items", "shop.open"]);
  });

  it("walks into nested Repeats", () => {
    const found = paths({
      type: "Container",
      children: [
        {
          type: "Repeat",
          items: { bind: "shop.categories" },
          children: [
            {
              type: "Repeat",
              items: { bind: "category.items" },
              children: [{ type: "Text", text: { bind: "item.name" } }],
            },
          ],
        },
      ],
    });

    // The inner Repeat is the outer template: everything under it is relative.
    expect(found).toEqual(["shop.categories"]);
  });

  it("hands the panel its paths in a stable order, whatever the tree's", () => {
    const found = paths({
      type: "Container",
      children: [
        { type: "Text", text: { bind: "zeta" } },
        { type: "Text", text: { bind: "alpha" } },
        { type: "Text", text: { bind: "mid" } },
      ],
    });

    // A save must not reshuffle the fields under the cursor.
    expect(found).toEqual(["alpha", "mid", "zeta"]);
  });
});

/**
 * The envelope declares no types for data — a binding says where a value goes,
 * never what it is — but the design does: the SITE is the type, which is what
 * lets the panel offer a checkbox instead of a box you type `true` into.
 */
describe("the type a binding is edited as", () => {
  it("reads the boolean sites off the design", () => {
    expect(
      typed({
        type: "Container",
        visible: { bind: "hud.visible" },
        children: [
          { type: "Toggle", checked: { bind: "settings.sound" } },
          { type: "Button", disabled: { bind: "shop.locked" } },
          { type: "Collapse", open: { bind: "panel.open" } },
        ],
      }),
    ).toEqual({
      "hud.visible": "boolean",
      "settings.sound": "boolean",
      "shop.locked": "boolean",
      "panel.open": "boolean",
    });
  });

  it("reads a Repeat's items as the array it instantiates", () => {
    expect(typed({ type: "Repeat", items: { bind: "shop.items" } })).toEqual({
      "shop.items": "array",
    });
  });

  it("tells the three `value`s apart by the node that owns them", () => {
    // The same word for three different values: a Slider's is a number, a
    // TextInput's is the text being edited, a radio group's is the option picked.
    expect(
      typed({
        type: "Container",
        children: [
          { type: "Slider", value: { bind: "audio.volume" } },
          { type: "ProgressBar", value: { bind: "quest.progress" } },
          { type: "TextInput", value: { bind: "profile.name" } },
          { type: "Container", group: "exclusive-check", value: { bind: "profile.difficulty" } },
        ],
      }),
    ).toEqual({
      "audio.volume": "number",
      "quest.progress": "number",
      "profile.name": "string",
      "profile.difficulty": "string",
    });
  });

  it("edits text as text", () => {
    expect(typed(GOLD)).toEqual({ "player.gold": "string" });
  });

  it("falls back to text on a prop it does not know", () => {
    // The format is forward-tolerant: a prop from a later version degrades into
    // the editor that can express anything, not into a guess.
    expect(typed({ type: "Text", futureProp: { bind: "some.path" } })).toEqual({
      "some.path": "string",
    });
  });

  it("reads the site through a states block, which declares no node of its own", () => {
    expect(typed({ type: "Toggle", states: { hover: { checked: { bind: "x" } } } })).toEqual({
      x: "boolean",
    });
  });
});

describe("a path bound in two places at once", () => {
  it("keeps the site that committed to something over the text fallback", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const found = typed({
      type: "Container",
      children: [
        { type: "Text", text: { bind: "shop.open" } },
        { type: "Container", visible: { bind: "shop.open" } },
      ],
    });

    expect(found).toEqual({ "shop.open": "boolean" });
    // One editor for a path the envelope reads two ways: which one it picked is
    // the difference between a bug and a decision, so it is said out loud.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("shop.open"));
    warn.mockRestore();
  });

  it("keeps it whichever way round the two sites are walked", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      typed({
        type: "Container",
        children: [
          { type: "Container", visible: { bind: "shop.open" } },
          { type: "Text", text: { bind: "shop.open" } },
        ],
      }),
    ).toEqual({ "shop.open": "boolean" });

    warn.mockRestore();
  });

  it("settles a tie between two committed sites on the first one walked", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Neither is a fallback, so nothing decides it but the walk — and the panel
    // being stable across saves is worth more than the choice itself.
    expect(
      typed({
        type: "Container",
        children: [
          { type: "Slider", value: { bind: "odd.one" } },
          { type: "Toggle", checked: { bind: "odd.one" } },
        ],
      }),
    ).toEqual({ "odd.one": "number" });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("says nothing when both sites agree", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      typed({
        type: "Container",
        children: [
          { type: "Toggle", checked: { bind: "settings.sound" } },
          { type: "Container", visible: { bind: "settings.sound" } },
        ],
      }),
    ).toEqual({ "settings.sound": "boolean" });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
