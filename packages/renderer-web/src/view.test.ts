import { afterEach, describe, expect, it } from "vitest";
import { mountCase, readCorpus, readEnvelope } from "./golden.js";
import { type GoldenView, mountGolden } from "./harness.js";
import { findNode, type NodeSnapshot, type ViewSnapshot } from "./snapshot.js";

/**
 * The invariants of `view.ts` — the dispatch and integration layer that had no
 * suite of its own until ZAB-48, and the one every task of the catalog adds a
 * branch to.
 *
 * These are written by hand, and deliberately NOT snapshots: a golden file
 * records geometry, and `-u` rewrites it without anyone reading the diff. What
 * is asserted here is behavior that must not change silently whatever the
 * geometry does — a modal capturing input, a drag that must not become a click,
 * an action carrying the item it fired from, a value written back to the game.
 *
 * They run against the same corpus the golden files are made of, so an envelope
 * is described once and serves both.
 */

const CORPUS = readCorpus();

let view: GoldenView | null = null;

afterEach(() => {
  view?.dispose();
  view = null;
});

/** Center of a node's rect — where a player would aim at it. */
function center(snapshot: ViewSnapshot, ref: string): { x: number; y: number } {
  const rect = node(snapshot, ref).rect;
  if (!rect) throw new Error(`golden: "${ref}" is out of layout, nothing to point at`);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function node(snapshot: ViewSnapshot, ref: string): NodeSnapshot {
  const found = findNode(snapshot, ref);
  if (!found) throw new Error(`golden: no node "${ref}" in the tree`);
  return found;
}

function states(snapshot: ViewSnapshot, ref: string): string[] {
  return node(snapshot, ref).states ?? [];
}

describe("hit-testing and actions", () => {
  it("fires the action of the button under the pointer, and only that one", async () => {
    view = await mountCase(CORPUS["states-tokens"]);
    const target = center(view.snapshot(), "primary");

    view.pointer.click(target.x, target.y);

    expect(view.actions).toEqual([{ action: "buy" }]);
  });

  it("fires nothing when the press and the release land on different nodes", async () => {
    view = await mountCase(CORPUS["states-tokens"]);
    const snapshot = view.snapshot();

    view.pointer.down(center(snapshot, "primary").x, center(snapshot, "primary").y);
    view.pointer.up(center(snapshot, "secondary").x, center(snapshot, "secondary").y);

    expect(view.actions).toEqual([]);
  });

  it("carries the press state for exactly as long as the pointer is down", async () => {
    view = await mountCase(CORPUS["states-tokens"]);
    const target = center(view.snapshot(), "primary");

    view.pointer.down(target.x, target.y);
    expect(states(view.snapshot(), "primary")).toContain("pressed");

    view.pointer.up(target.x, target.y);
    expect(states(view.snapshot(), "primary")).not.toContain("pressed");
  });

  it("hovers what the mouse is over and drops it when the pointer leaves", async () => {
    view = await mountCase(CORPUS["states-tokens"]);
    const target = center(view.snapshot(), "secondary");

    view.pointer.move(target.x, target.y);
    expect(view.snapshot().hover).toBe("secondary");
    expect(states(view.snapshot(), "secondary")).toContain("hover");

    view.pointer.leave();
    expect(view.snapshot().hover).toBeNull();
  });

  it("does not reach a child that its parent's clip cut away", async () => {
    view = await mountCase(CORPUS["scroll-clip"]);
    const snapshot = view.snapshot();
    const box = node(snapshot, "clipping-box").rect;
    const child = node(snapshot, "overflowing-child").rect;
    if (!box || !child) throw new Error("the clipping box is not in layout");

    // A point inside the overflowing child but OUTSIDE the box that clips it:
    // the input is cut exactly where the paint is (decision 2026-08-11).
    const outside = { x: box.x + box.width + 10, y: box.y + 10 };
    expect(outside.x).toBeLessThan(child.x + child.width);

    view.pointer.move(outside.x, outside.y);
    expect(view.snapshot().hover).toBeNull();
  });
});

describe("keyboard focus", () => {
  it("gives the initial focus to the autofocus node", async () => {
    view = await mountCase(CORPUS["states-tokens"]);

    expect(view.snapshot().focus).toBe("primary");
    expect(states(view.snapshot(), "primary")).toContain("focused");
  });

  it("moves the focus spatially, from the live rects", async () => {
    view = await mountCase(CORPUS["states-tokens"]);

    view.keyDown("ArrowDown");
    expect(view.snapshot().focus).toBe("secondary");

    view.keyDown("ArrowUp");
    expect(view.snapshot().focus).toBe("primary");
  });

  it("activates the focused control with Enter", async () => {
    view = await mountCase(CORPUS["states-tokens"]);

    view.keyDown("Enter");
    expect(states(view.snapshot(), "primary")).toContain("pressed");

    view.keyUp("Enter");
    expect(view.actions).toEqual([{ action: "buy" }]);
  });
});

describe("the overlay layer", () => {
  it("paints in (z, document order), lowest first", async () => {
    view = await mountCase(CORPUS.overlays);

    expect(view.snapshot().layer.map((entry) => entry.ref)).toEqual(["modal", "toast"]);
    expect(view.snapshot().layer.map((entry) => entry.z)).toEqual([10, 20]);
  });

  it("captures input: nothing under an open modal is reachable", async () => {
    view = await mountCase(CORPUS.overlays);
    const target = center(view.snapshot(), "under-modal");

    view.pointer.click(target.x, target.y);

    // The click landed on the modal's backdrop, which dismisses it — what it must
    // NOT do is press the button that happens to sit under the scrim.
    expect(view.actions).toEqual([{ action: "close-modal" }]);
  });

  it("takes the focus into the modal and keeps navigation inside it", async () => {
    view = await mountCase(CORPUS.overlays);

    expect(view.snapshot().focus).toBe("modal-accept");

    // There are focusables outside (the two buttons of the tree), so a focus that
    // left the modal would show up here.
    view.keyDown("ArrowDown");
    view.keyDown("ArrowUp");
    expect(view.snapshot().focus).toBe("modal-accept");
  });

  it("treats Escape as a dismiss request for the modal that owns the input", async () => {
    view = await mountCase(CORPUS.overlays);

    view.keyDown("Escape");

    expect(view.actions).toEqual([{ action: "close-modal" }]);
  });

  it("dismisses a toast on its own clock, and not before", async () => {
    view = await mountCase(CORPUS.overlays);

    view.advance(2999);
    expect(view.actions).toEqual([]);

    view.advance(2);
    expect(view.actions).toEqual([{ action: "close-toast" }]);
  });

  it("shows a hover-triggered tooltip only while its anchor is lit, anchored to it", async () => {
    view = await mountCase(CORPUS.overlays, { data: { "ui.modalOpen": false } });
    expect(view.snapshot().layer.map((entry) => entry.ref)).not.toContain("tooltip");

    const anchor = node(view.snapshot(), "tooltip-anchor").rect;
    if (!anchor) throw new Error("the anchor is not in layout");
    view.pointer.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);

    const shown = view.snapshot();
    expect(shown.layer.map((entry) => entry.ref)).toContain("tooltip");
    const bubble = node(shown, "tooltip-bubble").rect;
    if (!bubble) throw new Error("the tooltip is not in layout");
    // `at: "bottom"`, `offset: 8`: below the anchor, on the side it asked for.
    expect(bubble.y).toBeCloseTo(anchor.y + anchor.height + 8, 3);
    // Centered on the anchor would put it at x=6, inside the 8px margin the
    // overlay's own `padding` keeps from the view's edge — so it clamps to 8.
    // Placement flips and clamps with no field of its own (decision ZAB-46).
    expect(anchor.x + anchor.width / 2 - bubble.width / 2).toBeLessThan(8);
    expect(bubble.x).toBeCloseTo(8, 3);
  });
});

describe("anchored overlays and scrolling", () => {
  it("keeps an overlay in the layer exactly while its anchor is on screen", async () => {
    view = await mountCase(CORPUS.anchors);
    const refs = () => (view as GoldenView).snapshot().layer.map((entry) => entry.ref);
    expect(refs()).toContain("in-scroller-tip");
    // Its twin's anchor sits below the scroller's fold: nothing to point at.
    expect(refs()).not.toContain("below-fold-tip");

    // Scroll to the end: the first row leaves the viewport and the folded one
    // arrives. The layer reads the rects of the frame already laid out, so the
    // swap shows on the next one.
    view.handle.setScroll("anchor-scroller", 0, 76);
    view.settle();

    expect(refs()).not.toContain("in-scroller-tip");
    expect(refs()).toContain("below-fold-tip");
    // And the bubble hangs off the row's SCROLLED rect, not the one it had.
    const anchor = node(view.snapshot(), "below-fold").rect;
    const bubble = node(view.snapshot(), "below-fold-bubble").rect;
    if (!anchor || !bubble) throw new Error("the anchored pair is not in layout");
    expect(bubble.x).toBeCloseTo(anchor.x + anchor.width + 8, 3);
    expect(bubble.y + bubble.height / 2).toBeCloseTo(anchor.y + anchor.height / 2, 3);
  });
});

describe("the select popover (decision 2026-08-12, ZAB-25)", () => {
  // The settings case declares the whole flow: a Button anchor, a press-triggered
  // modal Overlay, and an exclusive-check list inside a ScrollView too short for
  // its options — bound to `settings.quality`, seeded to "Alta", the LAST option.

  it("opens on the anchor's press, focused on the selected option and scrolled to it", async () => {
    view = await mountCase(CORPUS.settings);
    expect(view.snapshot().layer).toEqual([]); // closed until pressed, whatever `visible` says

    const anchor = center(view.snapshot(), "quality");
    view.pointer.click(anchor.x, anchor.y);

    const open = view.snapshot();
    expect(open.layer.map((entry) => entry.ref)).toEqual(["quality-popover"]);
    // ON its selection: the option the group already holds, not the first one.
    expect(open.focus).toBe("quality-alta");
    // And SEEN: "Alta" is the last option of a list that does not fit, so the
    // reveal scrolls the popover's own ScrollView on the very frame it opened.
    const scroll = node(open, "quality-list").scroll;
    expect(scroll?.maxY ?? 0).toBeGreaterThan(0);
    expect(scroll?.y).toBeCloseTo(scroll?.maxY ?? 0, 3);
  });

  it("chooses on tap: writes the value, closes the menu and gives the focus back", async () => {
    view = await mountCase(CORPUS.settings);
    const anchor = center(view.snapshot(), "quality");
    view.pointer.click(anchor.x, anchor.y);

    const option = center(view.snapshot(), "quality-media");
    view.pointer.click(option.x, option.y);

    // The choice travels the data channel's return leg, once.
    expect(view.writes).toEqual([{ path: "settings.quality", value: "Media" }]);
    // And the group's named action fires with it: a `<Select onChange>` is a
    // real hook, not a documented no-op (ZAB-64). The options have none of their
    // own, so this is the only thing the game hears.
    expect(view.actions).toEqual([{ action: "quality-changed" }]);
    // The bound label on the anchor now reads what was chosen.
    expect(node(view.snapshot(), "quality-value").text?.lines[0].text).toBe("Media");
    // Choosing is the gesture that ends the menu, and the focus returns to the
    // anchor the popover interrupted.
    expect(view.snapshot().layer).toEqual([]);
    expect(view.snapshot().focus).toBe("quality");
  });

  it("also closes on the option already selected, without writing anything", async () => {
    view = await mountCase(CORPUS.settings);
    const anchor = center(view.snapshot(), "quality");
    view.pointer.click(anchor.x, anchor.y);

    const option = center(view.snapshot(), "quality-alta");
    view.pointer.click(option.x, option.y);

    // "I meant this one" is still a choice: the menu must not become a dead end.
    expect(view.snapshot().layer).toEqual([]);
    expect(view.writes).toEqual([]);
    expect(view.actions).toEqual([]);
  });

  it("activates an option with Enter too — the keyboard and the pointer share the flow", async () => {
    view = await mountCase(CORPUS.settings);
    const anchor = center(view.snapshot(), "quality");
    view.pointer.click(anchor.x, anchor.y);
    expect(view.snapshot().focus).toBe("quality-alta");

    view.keyDown("ArrowUp");
    expect(view.snapshot().focus).toBe("quality-media");

    view.press();

    expect(view.writes).toEqual([{ path: "settings.quality", value: "Media" }]);
    // Same flow, same hook: the action does not care which input caused it.
    expect(view.actions).toEqual([{ action: "quality-changed" }]);
    expect(view.snapshot().layer).toEqual([]);
  });
});

describe("scrolling", () => {
  it("scrolls with the wheel and clamps at the end of the content", async () => {
    view = await mountCase(CORPUS["scroll-clip"]);
    const target = center(view.snapshot(), "vertical");
    const max = node(view.snapshot(), "vertical").scroll?.maxY ?? 0;
    expect(max).toBeGreaterThan(0);

    view.pointer.wheel(target.x, target.y, 0, 40);
    expect(node(view.snapshot(), "vertical").scroll?.y).toBeCloseTo(40, 3);

    view.pointer.wheel(target.x, target.y, 0, 10_000);
    expect(node(view.snapshot(), "vertical").scroll?.y).toBeCloseTo(max, 3);
  });

  it("moves the content on a drag, and that drag is not a click", async () => {
    view = await mountCase(CORPUS["scroll-clip"]);
    const target = center(view.snapshot(), "vertical");

    view.pointer.down(target.x, target.y);
    view.pointer.move(target.x, target.y - 30);
    view.pointer.up(target.x, target.y - 30);

    expect(node(view.snapshot(), "vertical").scroll?.y).toBeGreaterThan(0);
    expect(view.actions).toEqual([]);
  });

  it("ignores a wheel on an axis the scroller does not scroll", async () => {
    view = await mountCase(CORPUS["scroll-clip"]);
    const target = center(view.snapshot(), "vertical");

    view.pointer.wheel(target.x, target.y, 25, 0);

    expect(node(view.snapshot(), "vertical").scroll?.x).toBe(0);
  });
});

describe("controls", () => {
  it("sets a Slider from the pointer, reporting every change but committing once", async () => {
    view = await mountCase(CORPUS.controls);
    const track = node(view.snapshot(), "volume").rect;
    if (!track) throw new Error("the slider is not in layout");
    const y = track.y + track.height / 2;

    view.pointer.down(track.x + track.width / 2, y);
    view.pointer.move(track.x + track.width, y);
    view.pointer.up(track.x + track.width, y);

    expect(node(view.snapshot(), "volume").value).toBe(1);
    // `onCommit` is "the value the player settled on": exactly one, at the end.
    expect(view.actions.filter((fired) => fired.action === "volume-committed")).toHaveLength(1);
    expect(view.actions.at(-1)).toEqual({ action: "volume-committed" });
    expect(
      view.actions.filter((fired) => fired.action === "volume-changed").length,
    ).toBeGreaterThan(1);
  });

  it("quantizes a stepped Slider to its step", async () => {
    view = await mountCase(CORPUS.controls);
    const track = node(view.snapshot(), "quality").rect;
    if (!track) throw new Error("the slider is not in layout");

    // A third of the way up a 0..4 range with step 1 — a continuous slider would
    // land between two stops.
    view.pointer.down(track.x + track.width / 2, track.y + track.height * 0.7);
    view.pointer.up(track.x + track.width / 2, track.y + track.height * 0.7);

    expect(node(view.snapshot(), "quality").value).toBe(1);
  });

  it("toggles on tap, fires onChange and writes the new value back to the game", async () => {
    view = await mountCase(CORPUS.bindings);
    const target = center(view.snapshot(), "bound-toggle");

    view.pointer.click(target.x, target.y);

    expect(states(view.snapshot(), "bound-toggle")).not.toContain("checked");
    expect(view.actions).toEqual([{ action: "sound-changed" }]);
    expect(view.writes).toEqual([{ path: "settings.sound", value: false }]);
  });

  it("picks one option of a radio group by value", async () => {
    view = await mountCase(CORPUS.controls);
    const target = center(view.snapshot(), "radio-low");

    view.pointer.click(target.x, target.y);

    expect(states(view.snapshot(), "radio-low")).toContain("checked");
    expect(states(view.snapshot(), "radio-medium")).not.toContain("checked");
  });

  it("fires the option's hook and then the group's — two questions, both answered", async () => {
    view = await mountCase(CORPUS.controls);
    const target = center(view.snapshot(), "radio-low");

    view.pointer.click(target.x, target.y);

    // Inner first: "this one was tapped", then "the selection moved". Neither
    // carries the value — that is the data channel's leg (ZAB-64).
    expect(view.actions).toEqual([
      { action: "difficulty-low-picked" },
      { action: "difficulty-changed" },
    ]);
  });

  it("says nothing when the choice is the option already selected", async () => {
    view = await mountCase(CORPUS.controls);
    const target = center(view.snapshot(), "radio-medium");

    view.pointer.click(target.x, target.y);

    expect(states(view.snapshot(), "radio-medium")).toContain("checked");
    expect(view.actions).toEqual([]);
  });
});

describe("sections that enter and leave layout", () => {
  it("toggles a Collapse from its header and closes its siblings in the group", async () => {
    view = await mountCase(CORPUS["collapse-tabs"]);
    expect(node(view.snapshot(), "content-a").out).toBeUndefined();
    expect(node(view.snapshot(), "content-b").out).toBe("section");

    const header = center(view.snapshot(), "header-b");
    view.pointer.click(header.x, header.y);

    // "exclusive-open": opening B closes A.
    expect(node(view.snapshot(), "content-b").out).toBeUndefined();
    expect(node(view.snapshot(), "content-a").out).toBe("section");
  });

  it("swaps the panel of an exclusive-select group and moves the selected state", async () => {
    view = await mountCase(CORPUS["collapse-tabs"]);
    const target = center(view.snapshot(), "tab-0");

    view.pointer.click(target.x, target.y);

    expect(states(view.snapshot(), "tab-0")).toContain("selected");
    expect(states(view.snapshot(), "tab-1")).not.toContain("selected");
    expect(node(view.snapshot(), "panel-0").out).toBeUndefined();
    expect(node(view.snapshot(), "panel-1").out).toBe("section");
  });

  it("prunes a statically invisible node, but keeps a bound one addressable", async () => {
    view = await mountCase(CORPUS.bindings);

    // `visible: false` in the document is pruned at build time — it is not a
    // runtime state, so there is no node to come back.
    expect(findNode(view.snapshot(), "static-invisible")).toBeNull();
    // A BOUND `visible` builds normally and only leaves layout, so the data can
    // bring it back without rebuilding the tree.
    expect(node(view.snapshot(), "bound-visible-off").out).toBe("visible");

    view.handle.setData("flags.banned", true);
    expect(node(view.snapshot(), "bound-visible-off").out).toBeUndefined();
  });
});

describe("the disabled state (decision 2026-08-17, ZAB-63)", () => {
  it("fires nothing when a disabled control is clicked", async () => {
    view = await mountCase(CORPUS.disabled);
    const target = center(view.snapshot(), "off");

    view.pointer.click(target.x, target.y);

    expect(view.actions).toEqual([]);
    expect(states(view.snapshot(), "off")).not.toContain("pressed");
  });

  it("leaves the navigation: the arrows walk past it", async () => {
    view = await mountCase(CORPUS.disabled);
    expect(view.snapshot().focus).toBe("live");

    // `off` sits directly under `live`, and the disabled section under that: the
    // first candidate downwards is the field, the only live control below.
    view.keyDown("ArrowDown");

    expect(view.snapshot().focus).not.toBe("off");
    expect(states(view.snapshot(), "off")).not.toContain("focused");
  });

  it("never hovers, so a mouse and a pad see the same dead control", async () => {
    view = await mountCase(CORPUS.disabled);
    const target = center(view.snapshot(), "off");

    view.pointer.move(target.x, target.y);

    expect(states(view.snapshot(), "off")).not.toContain("hover");
    expect(view.snapshot().hover).toBeNull();
  });

  it("inherits: a control inside a disabled section does not answer either", async () => {
    view = await mountCase(CORPUS.disabled);
    const toggle = center(view.snapshot(), "section-toggle");
    expect(states(view.snapshot(), "section-toggle")).toContain("disabled");
    expect(states(view.snapshot(), "section-toggle")).toContain("checked");

    view.pointer.click(toggle.x, toggle.y);

    // Still on: the value it holds did not move, and the game was not told.
    expect(states(view.snapshot(), "section-toggle")).toContain("checked");
    expect(view.actions).toEqual([]);
    expect(view.writes).toEqual([]);
  });

  it("does not drag the Slider of a disabled section", async () => {
    view = await mountCase(CORPUS.disabled);
    const track = node(view.snapshot(), "section-slider").rect;
    if (!track) throw new Error("the slider is out of layout");
    const before = node(view.snapshot(), "section-slider").value;

    view.pointer.down(track.x + track.width * 0.9, track.y + track.height / 2);
    view.pointer.up(track.x + track.width * 0.9, track.y + track.height / 2);

    expect(node(view.snapshot(), "section-slider").value).toBe(before);
    expect(view.actions).toEqual([]);
  });

  it("does not toggle a disabled Collapse from its header", async () => {
    view = await mountCase(CORPUS.disabled);
    const header = center(view.snapshot(), "collapse-header");
    expect(node(view.snapshot(), "collapse-body").out).toBe("section");

    view.pointer.click(header.x, header.y);

    expect(node(view.snapshot(), "collapse-body").out).toBe("section");
  });

  it("keeps a disabled section READABLE: its ScrollView still scrolls", async () => {
    view = await mountCase(CORPUS.disabled);
    const target = center(view.snapshot(), "readable");
    const max = node(view.snapshot(), "readable").scroll?.maxY ?? 0;
    expect(max).toBeGreaterThan(0);

    view.pointer.wheel(target.x, target.y, 0, 5);
    // Scrolling is not an interaction the section owns — a control the player
    // cannot use is still one they must be able to read.
    expect(node(view.snapshot(), "readable").scroll?.y).toBeCloseTo(5, 3);

    view.pointer.wheel(target.x, target.y, 0, 10_000);
    expect(node(view.snapshot(), "readable").scroll?.y).toBeCloseTo(max, 3);
  });

  it("comes back to life when the data says so, controls included", async () => {
    view = await mountCase(CORPUS.disabled);
    expect(states(view.snapshot(), "section-toggle")).toContain("disabled");

    view.handle.setData("settings.custom", false);

    expect(states(view.snapshot(), "section-toggle")).not.toContain("disabled");
    expect(states(view.snapshot(), "section-label")).not.toContain("disabled");

    const toggle = center(view.snapshot(), "section-toggle");
    view.pointer.click(toggle.x, toggle.y);
    expect(view.actions).toEqual([{ action: "toggle-detail" }]);
  });

  it("releases the focus of a control the game disables under it", async () => {
    view = await mountCase(CORPUS.disabled);
    view.handle.setData("settings.custom", false);
    const field = center(view.snapshot(), "section-field");
    view.pointer.click(field.x, field.y);
    expect(view.snapshot().focus).toBe("section-field");

    view.handle.setData("settings.custom", true);

    // Focus goes to NOTHING, not to a neighbour: the player did not ask to move.
    expect(view.snapshot().focus).toBeNull();
    expect(states(view.snapshot(), "section-field")).not.toContain("focused");
  });

  it("carries the state on nodes that are not focusable at all", async () => {
    view = await mountCase(CORPUS.disabled);

    // What makes "disable the section" a real statement: the labels dim with it.
    expect(states(view.snapshot(), "section-label")).toContain("disabled");
    expect(states(view.snapshot(), "off-label")).toContain("disabled");
    expect(node(view.snapshot(), "off-label").style?.color).toBe("#5b6070");
  });
});

describe("the data channel", () => {
  it("re-measures and re-lays out a bound Text when the data moves", async () => {
    view = await mountCase(CORPUS.bindings);
    const before = node(view.snapshot(), "bound-text");

    view.handle.setData("player.gold", 999_999);

    const after = node(view.snapshot(), "bound-text");
    expect(after.text?.lines[0].text).toBe("999999");
    expect(after.rect?.width).toBeGreaterThan(before.rect?.width ?? 0);
  });

  it("keeps the slot and the gaps when a bound Text empties (ZAB-65)", async () => {
    // A literal "" loads too — the empty string is content, so the reader hands
    // over four children and the row is spaced for four (decision 2026-08-17).
    view = await mountGolden(
      {
        v: 1,
        tokens: {},
        views: {
          row: {
            type: "Container",
            layout: { direction: "row", gap: 8 },
            children: [
              { type: "Text", id: "before", text: "A" },
              { type: "Text", id: "status", text: { bind: "hud.status" } },
              { type: "Text", id: "blank", text: "" },
              { type: "Text", id: "after", text: "B" },
            ],
          },
        },
      },
      { data: { "hud.status": "listo" } },
    );
    expect(view.warnings).toEqual([]);
    const full = node(view.snapshot(), "status");
    const lineHeight = full.rect?.height ?? 0;
    const blank = node(view.snapshot(), "blank");
    const tail = node(view.snapshot(), "after");
    // The literal empty one is already a slot: no width, one line of height.
    expect(blank.rect?.width).toBe(0);
    expect(blank.rect?.height).toBe(lineHeight);

    view.handle.setData("hud.status", "");

    // The node is still there, still one line tall — which is what stops the row
    // from re-spacing itself the frame its string goes blank.
    const empty = node(view.snapshot(), "status");
    expect(empty.text?.lines.map((line) => line.text)).toEqual([""]);
    expect(empty.rect?.width).toBe(0);
    expect(empty.rect?.height).toBe(lineHeight);
    // Both of its gaps survive with it: everything after moves left by exactly the
    // width the text lost, and not by one gap more.
    const lost = full.rect?.width ?? 0;
    expect(empty.rect?.x).toBe(full.rect?.x);
    expect(node(view.snapshot(), "blank").rect?.x).toBeCloseTo((blank.rect?.x ?? 0) - lost, 3);
    expect(node(view.snapshot(), "after").rect?.x).toBeCloseTo((tail.rect?.x ?? 0) - lost, 3);
  });

  it("never reports a setData back to the game as a change", async () => {
    view = await mountCase(CORPUS.bindings);

    view.handle.setData("settings.sound", false);

    // The return leg is for values the CONTROLS produce; this one came from the
    // game and echoing it would be a loop (decision 2026-08-11, ZAB-23).
    expect(view.writes).toEqual([]);
  });
});

describe("repeated items", () => {
  it("realizes only the window the scroller can show, over the full reserved space", async () => {
    view = await mountCase(CORPUS.repeat);
    const list = node(view.snapshot(), "inventory");

    expect(list.window?.count).toBeLessThan(12);
    expect(list.window?.first).toBe(0);
    // The node still measures the WHOLE list, or the scrollbar would lie.
    expect(list.rect?.height).toBeCloseTo(list.window?.reserved ?? 0, 3);
  });

  it("moves the window as the list scrolls, asking for the frame that does it", async () => {
    view = await mountCase(CORPUS.repeat);
    const target = center(view.snapshot(), "list-scroller");

    view.pointer.wheel(target.x, target.y, 0, 200);
    // The scrolled frame still shows the old window: the plan reads rects the
    // expansion pass has already used. The view notices the drift and schedules
    // one more frame itself, which is the one that converges (`syncExtents`).
    expect(node(view.snapshot(), "inventory").window?.first).toBe(0);

    view.advance(16);

    expect(node(view.snapshot(), "inventory").window?.first).toBeGreaterThan(0);
  });

  it("says WHICH item an action fired from", async () => {
    view = await mountCase(CORPUS.repeat);
    // The second row: its instance is addressed by path, since every instance
    // wears the id of the template it came from.
    const target = center(view.snapshot(), "0.0.1");

    view.pointer.click(target.x, target.y);

    expect(view.actions).toEqual([
      { action: "buy", context: { path: "shop.items.1", key: "b", index: 1 } },
    ]);
  });

  it("shows the empty-state slot when the bound array is not there at all", async () => {
    view = await mountCase(CORPUS.repeat);

    expect(node(view.snapshot(), "nothing-yet").out).toBeUndefined();
    // The template is not a node: `children[0]` of a Repeat is only ever built as
    // instances, one per element the window can see. With no array there are none.
    expect(findNode(view.snapshot(), "never-shown")).toBeNull();
  });
});

describe("text fields", () => {
  it("types into the focused field and reports every edit", async () => {
    view = await mountCase(CORPUS.textinput);
    const target = center(view.snapshot(), "search");

    view.pointer.click(target.x, target.y);
    view.type("hola");

    expect(node(view.snapshot(), "search").field?.text).toBe("hola");
    expect(states(view.snapshot(), "search")).not.toContain("empty");
    expect(view.actions).toEqual([{ action: "search-changed" }]);
    expect(view.writes).toEqual([]);
  });

  it("bounds what the player can type with maxLength", async () => {
    view = await mountCase(CORPUS.textinput);
    const target = center(view.snapshot(), "name");

    view.pointer.click(target.x, target.y);
    view.keyDown("End");
    view.type("0123456789");

    // "Sergi" + as much as fits under the 12-character limit.
    expect(node(view.snapshot(), "name").field?.text).toBe("Sergi0123456");
  });

  it("submits on Enter", async () => {
    view = await mountCase(CORPUS.textinput);
    const target = center(view.snapshot(), "name");

    view.pointer.click(target.x, target.y);
    view.keyDown("Enter");

    expect(view.actions).toEqual([{ action: "name-accepted" }]);
  });

  it("places the caret where the pointer landed", async () => {
    view = await mountCase(CORPUS.textinput);
    const field = node(view.snapshot(), "name").rect;
    if (!field) throw new Error("the field is not in layout");

    // Far left of the content box: before the first character.
    view.pointer.click(field.x + 9, field.y + field.height / 2);

    expect(node(view.snapshot(), "name").field).toMatchObject({ anchor: 0, focus: 0 });
  });

  it("writes a field inside a Repeat into the item's own slot", async () => {
    view = await mountCase(CORPUS.textinput);
    // The second guest: instances wear the template's id, so the ref is its path.
    const target = center(view.snapshot(), "4.1");

    view.pointer.click(target.x, target.y);
    view.keyDown("End");
    view.type("!");

    expect(node(view.snapshot(), "4.1").field?.text).toBe("Bo!");
    // The scope resolves the write — `guest.name` is not a slot of the store.
    expect(view.writes).toEqual([{ path: "form.guests.1.name", value: "Bo!" }]);
    expect(view.actions).toEqual([
      { action: "guest-renamed", context: { path: "form.guests.1", key: "bo", index: 1 } },
    ]);
  });

  it("says WHICH item a submit came from", async () => {
    view = await mountCase(CORPUS.textinput);
    const target = center(view.snapshot(), "4.0");

    view.pointer.click(target.x, target.y);
    view.keyDown("Enter");

    expect(view.actions).toEqual([
      { action: "guest-confirmed", context: { path: "form.guests.0", key: "ana", index: 0 } },
    ]);
  });

  it("keeps the game out of it until a composition settles", async () => {
    view = await mountCase(CORPUS.textinput);
    const target = center(view.snapshot(), "search");

    view.pointer.click(target.x, target.y);
    view.compose.start();
    view.compose.update("にほn");

    // The field shows what is being composed; half a syllable is not a value.
    expect(node(view.snapshot(), "search").field?.text).toBe("にほn");
    expect(view.actions).toEqual([]);

    view.compose.end();
    expect(view.actions).toEqual([{ action: "search-changed" }]);
  });
});

/**
 * The dev loop reloads on every save (ZAB-57), so anything that outlives a
 * `build()` is not a one-off: it accumulates until something reaches into a node
 * nobody is showing any more. The hidden `<textarea>` is the one input device
 * that genuinely outlives the tree — it belongs to the canvas, not to the
 * document drawn on it.
 */
describe("hot reload", () => {
  it("drops an IME composition the reload interrupted", async () => {
    view = await mountCase(CORPUS.textinput);
    const target = center(view.snapshot(), "search");
    view.pointer.click(target.x, target.y);
    view.compose.start();
    view.compose.update("にほn");

    view.handle.reload(readEnvelope(CORPUS.textinput.envelope));
    view.compose.end();

    // Without the reset the commit lands on the node from the tree that was
    // thrown away, and the game hears an `onChange` for a field nobody is
    // showing — from text the player was still writing when they saved.
    expect(view.actions).toEqual([]);
    expect(node(view.snapshot(), "search").field?.text).toBe("");
  });

  it("hands the keyboard back, so the field is not still holding it", async () => {
    view = await mountCase(CORPUS.textinput);
    const target = center(view.snapshot(), "search");
    view.pointer.click(target.x, target.y);

    view.handle.reload(readEnvelope(CORPUS.textinput.envelope));

    // A rebuild focuses nothing until the first render settles `autofocus`.
    expect(states(view.snapshot(), "search")).not.toContain("focused");
    expect(view.focusedEditor()).toBe(false);
  });
});

describe("transitions", () => {
  it("interpolates between the endpoints instead of snapping", async () => {
    view = await mountCase(CORPUS.transitions);
    const target = center(view.snapshot(), "tweened");
    const idle = node(view.snapshot(), "tweened").style?.background;

    view.pointer.move(target.x, target.y);
    const started = node(view.snapshot(), "tweened").style?.background;
    view.advance(200);
    const midway = node(view.snapshot(), "tweened").style?.background;
    view.advance(200);
    const settled = node(view.snapshot(), "tweened").style?.background;

    expect(started).toBe(idle); // frame zero of the tween is still the old value
    expect(midway).not.toBe(idle);
    expect(midway).not.toBe(settled);
    expect(settled).toBe("#f97316"); // the hover endpoint, reached exactly
  });

  it("snaps a node that declares no transition", async () => {
    view = await mountCase(CORPUS.transitions);
    const target = center(view.snapshot(), "instant");

    view.pointer.move(target.x, target.y);

    expect(node(view.snapshot(), "instant").style?.background).toBe("#f97316");
  });

  it("tweens a ProgressBar's fraction, never its rect", async () => {
    view = await mountCase(CORPUS.transitions);

    view.handle.setData("job.progress", 1);
    view.advance(200);

    const bar = node(view.snapshot(), "tweened-bar");
    const fill = node(view.snapshot(), "bar-fill");
    const value = bar.value ?? 0;
    expect(value).toBeGreaterThan(0.25);
    expect(value).toBeLessThan(1);
    // The fill's rect is derived from the interpolated fraction by the ordinary
    // layout pass — one pass per frame, and both targets get the same number.
    expect(fill.rect?.width).toBeCloseTo((bar.rect?.width ?? 0) * value, 3);
  });
});

/**
 * Transitions × recycling (ZAB-66): a virtualized list whose rows LOOK different
 * per item, which in v1 only happens through the state flags — no style value is
 * bindable. So `disabled` is bound per element and the row styles itself on it,
 * its label styles itself on the SAME flag without reading any data (the
 * inherited-state case, which is not in `this.bound`), and the Toggle carries a
 * behavior value of its own. Everything declares a transition, so anything that
 * fails to settle is visible as a tween.
 *
 * The template declares no ids: every instance would wear them, so the rows are
 * addressed by their path (`0.0.<n>`) — see `refMap`.
 */
const RECYCLING = {
  v: 1,
  tokens: {},
  views: {
    list: {
      type: "Container",
      layout: { direction: "column", align: "start" },
      children: [
        {
          type: "ScrollView",
          id: "scroller",
          axis: "vertical",
          layout: { direction: "column", width: 220, height: 100 },
          children: [
            {
              type: "Repeat",
              items: { bind: "shop.items" },
              as: "item",
              key: "id",
              layout: { direction: "column", align: "start" },
              children: [
                {
                  type: "Container",
                  disabled: { bind: "item.locked" },
                  transition: { duration: 400, easing: "linear" },
                  layout: { direction: "row", width: 200, height: 40, align: "center" },
                  style: { background: "#111111" },
                  states: { disabled: { style: { background: "#ff0000" } } },
                  children: [
                    {
                      type: "Text",
                      text: { bind: "item.name" },
                      transition: { duration: 400, easing: "linear" },
                      style: { color: "#00ff00" },
                      states: { disabled: { style: { color: "#0000ff" } } },
                    },
                    {
                      type: "Toggle",
                      checked: { bind: "item.on" },
                      transition: { duration: 400, easing: "linear" },
                      layout: { width: 20, height: 20 },
                      children: [
                        { type: "Container", layout: { width: 8, height: 8 } },
                        { type: "Container", layout: { width: 8, height: 8 } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

/** Odd rows are idle, even ones locked and checked — so a reorder is visible. */
function catalogue(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({
    id: `id${i}`,
    name: `item ${i}`,
    locked: i % 2 === 0,
    on: i % 2 === 0,
  }));
}

/** What one row PAINTED this frame: the two style halves and the behavior value. */
function painted(
  snapshot: ViewSnapshot,
  index: number,
): {
  name: string;
  background?: string | number;
  labelColor?: string | number;
  checkedProgress?: number;
} {
  const row = node(snapshot, `0.0.${index}`);
  const label = row.children?.[0];
  const toggle = row.children?.[1];
  return {
    name: label?.text?.lines.map((line) => line.text).join("") ?? "",
    background: row.style?.background,
    labelColor: label?.style?.color,
    checkedProgress: toggle?.value,
  };
}

/** What an idle row and a locked one paint — the two looks an item can have. */
const IDLE = { background: "#111111", labelColor: "#00ff00", checkedProgress: 0 };
const LOCKED = { background: "#ff0000", labelColor: "#0000ff", checkedProgress: 1 };

/** The look `catalogue` asks for at that item's index: the even ones are locked. */
function ownLook(name: string): Record<string, unknown> {
  return { name, ...(Number(name.split(" ")[1]) % 2 === 0 ? LOCKED : IDLE) };
}

async function mountRecycling(count: number): Promise<GoldenView> {
  const mounted = await mountGolden(RECYCLING, { data: { "shop.items": catalogue(count) } });
  // The second frame windows the rows the first one measured; the clock then runs
  // past the longest duration, so nothing is left in flight from the mount.
  mounted.settle();
  mounted.advance(400);
  return mounted;
}

describe("repeat recycling × transitions", () => {
  it("settles a reused instance on the element it now shows, subtree included", async () => {
    const mounted = await mountRecycling(4);
    view = mounted;
    // Same keys reversed, and every element's own flags flipped: each instance
    // travels with its item to another index — the rescope — and lands on data
    // that really did move. What it must NOT do is slide there from the row it
    // was showing a frame ago.
    const flipped = catalogue(4)
      .reverse()
      .map((item) => ({ ...item, locked: !item.locked, on: !item.on }));

    mounted.handle.setData("shop.items", flipped);
    const first = [0, 1, 2, 3].map((i) => painted(mounted.snapshot(), i));
    mounted.advance(400);
    const settled = [0, 1, 2, 3].map((i) => painted(mounted.snapshot(), i));

    // The frame the instances were reused on is already the settled one: nothing
    // was left tweening — the bound row's own state style, the label's inherited
    // one and the Toggle's crossfade included.
    expect(first).toEqual(settled);
    expect(first.map((row) => row.name)).toEqual(["item 3", "item 2", "item 1", "item 0"]);
    // "item 3" was idle and its flags flipped, so the row that now shows it is
    // locked from the very first frame.
    expect(first[0]).toEqual({ name: "item 3", ...LOCKED });
    expect(first[1]).toEqual({ name: "item 2", ...IDLE });
  });

  it("keeps animating when it is the item's OWN data that changed", async () => {
    const mounted = await mountRecycling(4);
    view = mounted;
    // No instance moves — the array keeps its order and its keys — so this is a
    // value change on the row that is already showing that element, and the CSS
    // model applies: it tweens (decision 2026-08-11 §4).
    mounted.handle.setData("shop.items.0.locked", false);
    mounted.handle.setData("shop.items.0.on", false);
    const started = painted(mounted.snapshot(), 0);
    mounted.advance(200);
    const midway = painted(mounted.snapshot(), 0);
    mounted.advance(200);
    const settled = painted(mounted.snapshot(), 0);

    expect(started).toEqual({ name: "item 0", ...LOCKED }); // frame zero: the old values
    expect(midway.background).not.toBe(started.background);
    expect(midway.background).not.toBe(settled.background);
    expect(midway.labelColor).not.toBe(started.labelColor);
    expect(midway.checkedProgress).toBeGreaterThan(0);
    expect(midway.checkedProgress).toBeLessThan(1);
    expect(settled).toEqual({ name: "item 0", ...IDLE });
  });

  it("shows the rows a scroll brought in with their own values, from the first frame", async () => {
    const mounted = await mountRecycling(30);
    view = mounted;
    const target = center(mounted.snapshot(), "scroller");

    // Several viewports in one gesture: the window is computed from the previous
    // frame's rects, so the rows it brings in appear on the frame after.
    mounted.pointer.wheel(target.x, target.y, 0, 600);
    mounted.advance(16);
    const appeared = [0, 1, 2, 3].map((i) => painted(mounted.snapshot(), i));
    mounted.advance(400);
    const settled = [0, 1, 2, 3].map((i) => painted(mounted.snapshot(), i));

    // The window really moved, and what each row paints on the frame it appears
    // on is its OWN item — never a crossfade from whatever was at that position.
    expect(appeared[0].name).not.toBe("item 0");
    expect(appeared).toEqual(appeared.map((row) => ownLook(row.name)));
    expect(settled).toEqual(appeared);
  });
});

describe("author errors", () => {
  it("warns once about an unknown token and paints the missing-color magenta", async () => {
    view = await mountGolden({
      v: 1,
      tokens: {},
      views: {
        broken: {
          type: "Container",
          id: "broken",
          layout: { width: 10, height: 10 },
          style: { background: "{color.nope}" },
        },
      },
    });

    // Reported ONCE, at load, naming the node and the property it sits on — not
    // once per frame from the style resolution (decision 2026-08-12, ZAB-37).
    expect(view.warnings).toHaveLength(1);
    expect(view.warnings[0]).toContain('views["broken"].style.background');
    expect(view.warnings[0]).toContain("{color.nope}");
    // The declared-but-unresolvable color still paints the missing-color magenta:
    // an author error is loud on screen, not silently invisible.
    expect(node(view.snapshot(), "broken").style?.background).toBe("#ff00ff");
  });
});
