import type { Diagnostic } from "@zabloo/format";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { GlyphAtlas } from "./glyphs.js";
import { mountCase, readCorpus, readEnvelope } from "./golden.js";
import { type GoldenView, mountGolden } from "./harness.js";
import { findNode, type NodeSnapshot, type ViewSnapshot } from "./snapshot.js";
import type { FrameStats } from "./view.js";

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

/**
 * Mounts for ONE test and disposes it when that test ends. A helper rather than
 * a `let` shared through `afterEach`: the view a test works with is then a
 * `const` the test owns, and nothing survives into the next one.
 */
async function mountForTest(...args: Parameters<typeof mountCase>): Promise<GoldenView> {
  return disposeAfterTest(await mountCase(...args));
}

/** Same, for the tests that mount a raw envelope instead of a corpus case. */
async function mountEnvelope(...args: Parameters<typeof mountGolden>): Promise<GoldenView> {
  return disposeAfterTest(await mountGolden(...args));
}

function disposeAfterTest(view: GoldenView): GoldenView {
  onTestFinished(() => {
    view.dispose();
  });
  return view;
}

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
    const view = await mountForTest(CORPUS["states-tokens"]);
    const target = center(view.snapshot(), "primary");

    view.pointer.click(target.x, target.y);

    expect(view.actions).toEqual([{ action: "buy" }]);
  });

  it("fires nothing when the press and the release land on different nodes", async () => {
    const view = await mountForTest(CORPUS["states-tokens"]);
    const snapshot = view.snapshot();

    view.pointer.down(center(snapshot, "primary").x, center(snapshot, "primary").y);
    view.pointer.up(center(snapshot, "secondary").x, center(snapshot, "secondary").y);

    expect(view.actions).toEqual([]);
  });

  it("carries the press state for exactly as long as the pointer is down", async () => {
    const view = await mountForTest(CORPUS["states-tokens"]);
    const target = center(view.snapshot(), "primary");

    view.pointer.down(target.x, target.y);
    expect(states(view.snapshot(), "primary")).toContain("pressed");

    view.pointer.up(target.x, target.y);
    expect(states(view.snapshot(), "primary")).not.toContain("pressed");
  });

  it("hovers what the mouse is over and drops it when the pointer leaves", async () => {
    const view = await mountForTest(CORPUS["states-tokens"]);
    const target = center(view.snapshot(), "secondary");

    view.pointer.move(target.x, target.y);
    expect(view.snapshot().hover).toBe("secondary");
    expect(states(view.snapshot(), "secondary")).toContain("hover");

    view.pointer.leave();
    expect(view.snapshot().hover).toBeNull();
  });

  it("does not reach a child that its parent's clip cut away", async () => {
    const view = await mountForTest(CORPUS["scroll-clip"]);
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
    const view = await mountForTest(CORPUS["states-tokens"]);

    expect(view.snapshot().focus).toBe("primary");
    expect(states(view.snapshot(), "primary")).toContain("focused");
  });

  it("moves the focus spatially, from the live rects", async () => {
    const view = await mountForTest(CORPUS["states-tokens"]);

    view.keyDown("ArrowDown");
    expect(view.snapshot().focus).toBe("secondary");

    view.keyDown("ArrowUp");
    expect(view.snapshot().focus).toBe("primary");
  });

  it("activates the focused control with Enter", async () => {
    const view = await mountForTest(CORPUS["states-tokens"]);

    view.keyDown("Enter");
    expect(states(view.snapshot(), "primary")).toContain("pressed");

    view.keyUp("Enter");
    expect(view.actions).toEqual([{ action: "buy" }]);
  });
});

describe("the overlay layer", () => {
  it("paints in (z, document order), lowest first", async () => {
    const view = await mountForTest(CORPUS.overlays);

    expect(view.snapshot().layer.map((entry) => entry.ref)).toEqual(["modal", "toast"]);
    expect(view.snapshot().layer.map((entry) => entry.z)).toEqual([10, 20]);
  });

  it("captures input: nothing under an open modal is reachable", async () => {
    const view = await mountForTest(CORPUS.overlays);
    const target = center(view.snapshot(), "under-modal");

    view.pointer.click(target.x, target.y);

    // The click landed on the modal's backdrop, which dismisses it — what it must
    // NOT do is press the button that happens to sit under the scrim.
    expect(view.actions).toEqual([{ action: "close-modal" }]);
  });

  it("takes the focus into the modal and keeps navigation inside it", async () => {
    const view = await mountForTest(CORPUS.overlays);

    expect(view.snapshot().focus).toBe("modal-accept");

    // There are focusables outside (the two buttons of the tree), so a focus that
    // left the modal would show up here.
    view.keyDown("ArrowDown");
    view.keyDown("ArrowUp");
    expect(view.snapshot().focus).toBe("modal-accept");
  });

  it("treats Escape as a dismiss request for the modal that owns the input", async () => {
    const view = await mountForTest(CORPUS.overlays);

    view.keyDown("Escape");

    expect(view.actions).toEqual([{ action: "close-modal" }]);
  });

  it("dismisses a toast on its own clock, and not before", async () => {
    const view = await mountForTest(CORPUS.overlays);

    view.advance(2999);
    expect(view.actions).toEqual([]);

    view.advance(2);
    expect(view.actions).toEqual([{ action: "close-toast" }]);
  });

  it("shows a hover-triggered tooltip only while its anchor is lit, anchored to it", async () => {
    const view = await mountForTest(CORPUS.overlays, { data: { "ui.modalOpen": false } });
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
    const view = await mountForTest(CORPUS.anchors);
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
    const view = await mountForTest(CORPUS.settings);
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
    const view = await mountForTest(CORPUS.settings);
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
    const view = await mountForTest(CORPUS.settings);
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
    const view = await mountForTest(CORPUS.settings);
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
    const view = await mountForTest(CORPUS["scroll-clip"]);
    const target = center(view.snapshot(), "vertical");
    const max = node(view.snapshot(), "vertical").scroll?.maxY ?? 0;
    expect(max).toBeGreaterThan(0);

    view.pointer.wheel(target.x, target.y, 0, 40);
    expect(node(view.snapshot(), "vertical").scroll?.y).toBeCloseTo(40, 3);

    view.pointer.wheel(target.x, target.y, 0, 10_000);
    expect(node(view.snapshot(), "vertical").scroll?.y).toBeCloseTo(max, 3);
  });

  it("moves the content on a drag, and that drag is not a click", async () => {
    const view = await mountForTest(CORPUS["scroll-clip"]);
    const target = center(view.snapshot(), "vertical");

    view.pointer.down(target.x, target.y);
    view.pointer.move(target.x, target.y - 30);
    view.pointer.up(target.x, target.y - 30);

    expect(node(view.snapshot(), "vertical").scroll?.y).toBeGreaterThan(0);
    expect(view.actions).toEqual([]);
  });

  it("ignores a wheel on an axis the scroller does not scroll", async () => {
    const view = await mountForTest(CORPUS["scroll-clip"]);
    const target = center(view.snapshot(), "vertical");

    view.pointer.wheel(target.x, target.y, 25, 0);

    expect(node(view.snapshot(), "vertical").scroll?.x).toBe(0);
  });
});

describe("a pointer that is cancelled instead of released (ZAB-70)", () => {
  it("drops a press without activating it — a cancel is not a click", async () => {
    const view = await mountForTest(CORPUS["states-tokens"]);
    const target = center(view.snapshot(), "primary");

    view.pointer.down(target.x, target.y);
    expect(states(view.snapshot(), "primary")).toContain("pressed");

    view.pointer.cancel();

    // The button comes back up and its action never fires: an interrupted touch
    // is not how a player buys something.
    expect(states(view.snapshot(), "primary")).not.toContain("pressed");
    expect(view.actions).toEqual([]);
    // And the gesture is really over — a later release presses nothing either.
    view.pointer.up(target.x, target.y);
    expect(view.actions).toEqual([]);
  });

  it("settles a Slider that was mid-drag: the value it left is the value it committed", async () => {
    const view = await mountForTest(CORPUS.controls);
    const track = node(view.snapshot(), "volume").rect;
    if (!track) throw new Error("the slider is not in layout");
    const y = track.y + track.height / 2;

    view.pointer.down(track.x + track.width / 2, y);
    view.pointer.move(track.x + track.width, y);
    view.pointer.cancel();

    // The value is on screen and was written into its bound path on every move,
    // so refusing `onCommit` would leave the game without the "apply it" event
    // for a value the player really did leave there.
    expect(node(view.snapshot(), "volume").value).toBe(1);
    expect(view.actions.filter((fired) => fired.action === "volume-committed")).toHaveLength(1);
    // Nothing is dragging any more: a move that arrives afterwards is not the gesture.
    view.pointer.move(track.x, y);
    expect(node(view.snapshot(), "volume").value).toBe(1);
  });

  it("ends a scroll drag, so the pointer stops dragging the list around", async () => {
    const view = await mountForTest(CORPUS["scroll-clip"]);
    const target = center(view.snapshot(), "vertical");

    view.pointer.down(target.x, target.y);
    view.pointer.move(target.x, target.y - 30);
    const scrolled = node(view.snapshot(), "vertical").scroll?.y ?? 0;
    expect(scrolled).toBeGreaterThan(0);

    view.pointer.cancel();
    view.pointer.move(target.x, target.y - 90);

    expect(node(view.snapshot(), "vertical").scroll?.y).toBeCloseTo(scrolled, 3);
  });

  it("does not dismiss the modal whose backdrop it had pressed", async () => {
    const view = await mountForTest(CORPUS.overlays);
    const target = center(view.snapshot(), "under-modal");

    view.pointer.down(target.x, target.y);
    view.pointer.cancel();
    view.pointer.up(target.x, target.y);

    expect(view.actions).toEqual([]);
    expect(view.snapshot().layer.map((entry) => entry.ref)).toContain("modal");
  });
});

describe("controls", () => {
  it("sets a Slider from the pointer, reporting every change but committing once", async () => {
    const view = await mountForTest(CORPUS.controls);
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
    const view = await mountForTest(CORPUS.controls);
    const track = node(view.snapshot(), "quality").rect;
    if (!track) throw new Error("the slider is not in layout");

    // A third of the way up a 0..4 range with step 1 — a continuous slider would
    // land between two stops.
    view.pointer.down(track.x + track.width / 2, track.y + track.height * 0.7);
    view.pointer.up(track.x + track.width / 2, track.y + track.height * 0.7);

    expect(node(view.snapshot(), "quality").value).toBe(1);
  });

  it("toggles on tap, fires onChange and writes the new value back to the game", async () => {
    const view = await mountForTest(CORPUS.bindings);
    const target = center(view.snapshot(), "bound-toggle");

    view.pointer.click(target.x, target.y);

    expect(states(view.snapshot(), "bound-toggle")).not.toContain("checked");
    expect(view.actions).toEqual([{ action: "sound-changed" }]);
    expect(view.writes).toEqual([{ path: "settings.sound", value: false }]);
  });

  it("picks one option of a radio group by value", async () => {
    const view = await mountForTest(CORPUS.controls);
    const target = center(view.snapshot(), "radio-low");

    view.pointer.click(target.x, target.y);

    expect(states(view.snapshot(), "radio-low")).toContain("checked");
    expect(states(view.snapshot(), "radio-medium")).not.toContain("checked");
  });

  it("fires the option's hook and then the group's — two questions, both answered", async () => {
    const view = await mountForTest(CORPUS.controls);
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
    const view = await mountForTest(CORPUS.controls);
    const target = center(view.snapshot(), "radio-medium");

    view.pointer.click(target.x, target.y);

    expect(states(view.snapshot(), "radio-medium")).toContain("checked");
    expect(view.actions).toEqual([]);
  });
});

describe("sections that enter and leave layout", () => {
  it("toggles a Collapse from its header and closes its siblings in the group", async () => {
    const view = await mountForTest(CORPUS["collapse-tabs"]);
    expect(node(view.snapshot(), "content-a").out).toBeUndefined();
    expect(node(view.snapshot(), "content-b").out).toBe("section");

    const header = center(view.snapshot(), "header-b");
    view.pointer.click(header.x, header.y);

    // "exclusive-open": opening B closes A.
    expect(node(view.snapshot(), "content-b").out).toBeUndefined();
    expect(node(view.snapshot(), "content-a").out).toBe("section");
  });

  it("swaps the panel of an exclusive-select group and moves the selected state", async () => {
    const view = await mountForTest(CORPUS["collapse-tabs"]);
    const target = center(view.snapshot(), "tab-0");

    view.pointer.click(target.x, target.y);

    expect(states(view.snapshot(), "tab-0")).toContain("selected");
    expect(states(view.snapshot(), "tab-1")).not.toContain("selected");
    expect(node(view.snapshot(), "panel-0").out).toBeUndefined();
    expect(node(view.snapshot(), "panel-1").out).toBe("section");
  });

  it("prunes a statically invisible node, but keeps a bound one addressable", async () => {
    const view = await mountForTest(CORPUS.bindings);

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
    const view = await mountForTest(CORPUS.disabled);
    const target = center(view.snapshot(), "off");

    view.pointer.click(target.x, target.y);

    expect(view.actions).toEqual([]);
    expect(states(view.snapshot(), "off")).not.toContain("pressed");
  });

  it("leaves the navigation: the arrows walk past it", async () => {
    const view = await mountForTest(CORPUS.disabled);
    expect(view.snapshot().focus).toBe("live");

    // `off` sits directly under `live`, and the disabled section under that: the
    // first candidate downwards is the field, the only live control below.
    view.keyDown("ArrowDown");

    expect(view.snapshot().focus).not.toBe("off");
    expect(states(view.snapshot(), "off")).not.toContain("focused");
  });

  it("never hovers, so a mouse and a pad see the same dead control", async () => {
    const view = await mountForTest(CORPUS.disabled);
    const target = center(view.snapshot(), "off");

    view.pointer.move(target.x, target.y);

    expect(states(view.snapshot(), "off")).not.toContain("hover");
    expect(view.snapshot().hover).toBeNull();
  });

  it("inherits: a control inside a disabled section does not answer either", async () => {
    const view = await mountForTest(CORPUS.disabled);
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
    const view = await mountForTest(CORPUS.disabled);
    const track = node(view.snapshot(), "section-slider").rect;
    if (!track) throw new Error("the slider is out of layout");
    const before = node(view.snapshot(), "section-slider").value;

    view.pointer.down(track.x + track.width * 0.9, track.y + track.height / 2);
    view.pointer.up(track.x + track.width * 0.9, track.y + track.height / 2);

    expect(node(view.snapshot(), "section-slider").value).toBe(before);
    expect(view.actions).toEqual([]);
  });

  it("does not toggle a disabled Collapse from its header", async () => {
    const view = await mountForTest(CORPUS.disabled);
    const header = center(view.snapshot(), "collapse-header");
    expect(node(view.snapshot(), "collapse-body").out).toBe("section");

    view.pointer.click(header.x, header.y);

    expect(node(view.snapshot(), "collapse-body").out).toBe("section");
  });

  it("keeps a disabled section READABLE: its ScrollView still scrolls", async () => {
    const view = await mountForTest(CORPUS.disabled);
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
    const view = await mountForTest(CORPUS.disabled);
    expect(states(view.snapshot(), "section-toggle")).toContain("disabled");

    view.handle.setData("settings.custom", false);

    expect(states(view.snapshot(), "section-toggle")).not.toContain("disabled");
    expect(states(view.snapshot(), "section-label")).not.toContain("disabled");

    const toggle = center(view.snapshot(), "section-toggle");
    view.pointer.click(toggle.x, toggle.y);
    expect(view.actions).toEqual([{ action: "toggle-detail" }]);
  });

  it("releases the focus of a control the game disables under it", async () => {
    const view = await mountForTest(CORPUS.disabled);
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
    const view = await mountForTest(CORPUS.disabled);

    // What makes "disable the section" a real statement: the labels dim with it.
    expect(states(view.snapshot(), "section-label")).toContain("disabled");
    expect(states(view.snapshot(), "off-label")).toContain("disabled");
    expect(node(view.snapshot(), "off-label").style?.color).toBe("#5b6070");
  });
});

describe("the data channel", () => {
  it("re-measures and re-lays out a bound Text when the data moves", async () => {
    const view = await mountForTest(CORPUS.bindings);
    const before = node(view.snapshot(), "bound-text");

    view.handle.setData("player.gold", 999_999);

    const after = node(view.snapshot(), "bound-text");
    expect(after.text?.lines[0].text).toBe("999999");
    expect(after.rect?.width).toBeGreaterThan(before.rect?.width ?? 0);
  });

  it("keeps the slot and the gaps when a bound Text empties (ZAB-65)", async () => {
    // A literal "" loads too — the empty string is content, so the reader hands
    // over four children and the row is spaced for four (decision 2026-08-17).
    const view = await mountEnvelope(
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
    const view = await mountForTest(CORPUS.bindings);

    view.handle.setData("settings.sound", false);

    // The return leg is for values the CONTROLS produce; this one came from the
    // game and echoing it would be a loop (decision 2026-08-11, ZAB-23).
    expect(view.writes).toEqual([]);
  });
});

describe("repeated items", () => {
  it("realizes only the window the scroller can show, over the full reserved space", async () => {
    const view = await mountForTest(CORPUS.repeat);
    const list = node(view.snapshot(), "inventory");

    expect(list.window?.count).toBeLessThan(12);
    expect(list.window?.first).toBe(0);
    // The node still measures the WHOLE list, or the scrollbar would lie.
    expect(list.rect?.height).toBeCloseTo(list.window?.reserved ?? 0, 3);
  });

  it("moves the window as the list scrolls, asking for the frame that does it", async () => {
    const view = await mountForTest(CORPUS.repeat);
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
    const view = await mountForTest(CORPUS.repeat);
    // The second row: its instance is addressed by path, since every instance
    // wears the id of the template it came from.
    const target = center(view.snapshot(), "0.0.1");

    view.pointer.click(target.x, target.y);

    expect(view.actions).toEqual([
      { action: "buy", context: { path: "shop.items.1", key: "b", index: 1 } },
    ]);
  });

  it("shows the empty-state slot when the bound array is not there at all", async () => {
    const view = await mountForTest(CORPUS.repeat);

    expect(node(view.snapshot(), "nothing-yet").out).toBeUndefined();
    // The template is not a node: `children[0]` of a Repeat is only ever built as
    // instances, one per element the window can see. With no array there are none.
    expect(findNode(view.snapshot(), "never-shown")).toBeNull();
  });
});

describe("text fields", () => {
  it("types into the focused field and reports every edit", async () => {
    const view = await mountForTest(CORPUS.textinput);
    const target = center(view.snapshot(), "search");

    view.pointer.click(target.x, target.y);
    view.type("hola");

    expect(node(view.snapshot(), "search").field?.text).toBe("hola");
    expect(states(view.snapshot(), "search")).not.toContain("empty");
    expect(view.actions).toEqual([{ action: "search-changed" }]);
    expect(view.writes).toEqual([]);
  });

  it("bounds what the player can type with maxLength", async () => {
    const view = await mountForTest(CORPUS.textinput);
    const target = center(view.snapshot(), "name");

    view.pointer.click(target.x, target.y);
    view.keyDown("End");
    view.type("0123456789");

    // "Sergi" + as much as fits under the 12-character limit.
    expect(node(view.snapshot(), "name").field?.text).toBe("Sergi0123456");
  });

  it("submits on Enter", async () => {
    const view = await mountForTest(CORPUS.textinput);
    const target = center(view.snapshot(), "name");

    view.pointer.click(target.x, target.y);
    view.keyDown("Enter");

    expect(view.actions).toEqual([{ action: "name-accepted" }]);
  });

  it("places the caret where the pointer landed", async () => {
    const view = await mountForTest(CORPUS.textinput);
    const field = node(view.snapshot(), "name").rect;
    if (!field) throw new Error("the field is not in layout");

    // Far left of the content box: before the first character.
    view.pointer.click(field.x + 9, field.y + field.height / 2);

    expect(node(view.snapshot(), "name").field).toMatchObject({ anchor: 0, focus: 0 });
  });

  it("writes a field inside a Repeat into the item's own slot", async () => {
    const view = await mountForTest(CORPUS.textinput);
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
    const view = await mountForTest(CORPUS.textinput);
    const target = center(view.snapshot(), "4.0");

    view.pointer.click(target.x, target.y);
    view.keyDown("Enter");

    expect(view.actions).toEqual([
      { action: "guest-confirmed", context: { path: "form.guests.0", key: "ana", index: 0 } },
    ]);
  });

  it("keeps the game out of it until a composition settles", async () => {
    const view = await mountForTest(CORPUS.textinput);
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
    const view = await mountForTest(CORPUS.textinput);
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
    const view = await mountForTest(CORPUS.textinput);
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
    const view = await mountForTest(CORPUS.transitions);
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
    const view = await mountForTest(CORPUS.transitions);
    const target = center(view.snapshot(), "instant");

    view.pointer.move(target.x, target.y);

    expect(node(view.snapshot(), "instant").style?.background).toBe("#f97316");
  });

  it("tweens a ProgressBar's fraction, never its rect", async () => {
    const view = await mountForTest(CORPUS.transitions);

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
  const mounted = await mountEnvelope(RECYCLING, { data: { "shop.items": catalogue(count) } });
  // The second frame windows the rows the first one measured; the clock then runs
  // past the longest duration, so nothing is left in flight from the mount.
  mounted.settle();
  mounted.advance(400);
  return mounted;
}

describe("repeat recycling × transitions", () => {
  it("settles a reused instance on the element it now shows, subtree included", async () => {
    const mounted = await mountRecycling(4);
    const _view = mounted;
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
    const _view = mounted;
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
    const _view = mounted;
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

/**
 * Focus × virtualization (ZAB-70): a focusable inside a virtualized row, and an
 * `autofocus` OUTSIDE the list — which is what makes a teleport visible. Without
 * the pending focus, scrolling the focused row out of the window would drop the
 * focus and the next frame would hand it to `away`, at the other end of the view.
 *
 * The template is a row with the Button one level down, so restoring the focus
 * really has to walk the path it recorded and not just re-focus the instance.
 */
const VIRTUAL_FOCUS = {
  v: 1,
  tokens: {},
  views: {
    inventory: {
      type: "Container",
      layout: { direction: "column", align: "start" },
      children: [
        {
          type: "Button",
          id: "away",
          autofocus: true,
          onClick: "away",
          layout: { width: 120, height: 24 },
        },
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
                  layout: { direction: "row", width: 200, height: 40, align: "center" },
                  children: [
                    { type: "Text", text: { bind: "item.name" } },
                    { type: "Button", onClick: "row", layout: { width: 60, height: 24 } },
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

/** The Button of the row at that position of the window — `Container` then `children[1]`. */
const ROW_BUTTON = (index: number) => `1.0.${index}.1`;

async function mountVirtualFocus(): Promise<GoldenView> {
  const mounted = await mountEnvelope(VIRTUAL_FOCUS, {
    data: {
      "shop.items": Array.from({ length: 30 }, (_, i) => ({ id: `id${i}`, name: `item ${i}` })),
    },
  });
  // The second frame windows the rows the first one measured.
  mounted.settle();
  return mounted;
}

/** Scrolls the list and lets the frame that moves the window run. */
function wheelList(mounted: GoldenView, delta: number): void {
  const target = center(mounted.snapshot(), "scroller");
  mounted.pointer.wheel(target.x, target.y, 0, delta);
  mounted.advance(16);
}

describe("focus on a virtualized row (ZAB-70)", () => {
  it("does not hand the focus to the view's autofocus when the row leaves the window", async () => {
    const mounted = await mountVirtualFocus();
    const _view = mounted;
    const target = center(mounted.snapshot(), ROW_BUTTON(0));
    mounted.pointer.click(target.x, target.y);
    expect(mounted.snapshot().focus).toBe(ROW_BUTTON(0));

    wheelList(mounted, 600);

    // The row really is gone from the window...
    expect(node(mounted.snapshot(), "1.0").window?.first).toBeGreaterThan(0);
    // ...and the focus went NOWHERE. Scrolling is not the player giving up the
    // focus, so it must not travel to a control at the other end of the screen.
    expect(mounted.snapshot().focus).toBeNull();
    expect(states(mounted.snapshot(), "away")).not.toContain("focused");
  });

  it("gives it back to the same item when the row is realized again", async () => {
    const mounted = await mountVirtualFocus();
    const _view = mounted;
    const target = center(mounted.snapshot(), ROW_BUTTON(1));
    mounted.pointer.click(target.x, target.y);
    const name = node(mounted.snapshot(), "1.0.1.0").text?.lines[0]?.text;

    wheelList(mounted, 600);
    expect(mounted.snapshot().focus).toBeNull();
    wheelList(mounted, -600);

    // Back at the top, and the focus is on the button of the row showing the very
    // item it was on — the identity travels, which is what a `key` is for.
    expect(mounted.snapshot().focus).toBe(ROW_BUTTON(1));
    expect(node(mounted.snapshot(), "1.0.1.0").text?.lines[0]?.text).toBe(name);
  });

  it("keeps the right stick scrolling the list the focus was in", async () => {
    const mounted = await mountVirtualFocus();
    const _view = mounted;
    const target = center(mounted.snapshot(), ROW_BUTTON(0));
    mounted.pointer.click(target.x, target.y);
    const pad = mounted.connectGamepad();

    wheelList(mounted, 600);
    const scrolled = node(mounted.snapshot(), "scroller").scroll?.y ?? 0;
    pad.axis(3, 1); // right stick down: scroll the ScrollView the focus lives in
    mounted.advance(16);
    mounted.advance(16);

    // The gesture that pushed the row off the window is exactly the one that
    // would have been cut by losing the focus mid-hold.
    expect(node(mounted.snapshot(), "scroller").scroll?.y ?? 0).toBeGreaterThan(scrolled);
  });

  it("starts the walk again from `autofocus` when the player presses a direction", async () => {
    const mounted = await mountVirtualFocus();
    const _view = mounted;
    const target = center(mounted.snapshot(), ROW_BUTTON(0));
    mounted.pointer.click(target.x, target.y);
    wheelList(mounted, 600);

    mounted.keyDown("ArrowDown");

    // The player asked to move and there is no rect to move from, so the pending
    // focus is dropped and the scope's `autofocus` takes it — the rule already
    // documented for having no focus at all.
    expect(mounted.snapshot().focus).toBe("away");
    // And it does not come back when the row is realized again: the question was
    // settled by a real focus decision.
    wheelList(mounted, -600);
    expect(mounted.snapshot().focus).toBe("away");
  });
});

/** Two focusables stacked, so an arrow that reached this view is visible in its focus. */
const TWO_BUTTONS = {
  v: 1,
  tokens: {},
  views: {
    pair: {
      type: "Container",
      layout: { direction: "column", align: "start", gap: 8, padding: 8 },
      children: [
        { type: "Button", id: "a", autofocus: true, layout: { width: 80, height: 24 } },
        { type: "Button", id: "b", layout: { width: 80, height: 24 } },
      ],
    },
  },
};

describe("two views mounted on one page (ZAB-70)", () => {
  it("gives the keyboard to the view the player last touched, and to it alone", async () => {
    const first = await mountEnvelope(TWO_BUTTONS);
    const _view = first;
    const second = await mountEnvelope(TWO_BUTTONS, { share: first });
    try {
      expect(first.snapshot().focus).toBe("a");
      expect(second.snapshot().focus).toBe("a");

      // `keydown` is a PAGE event: both views hear it, and only the owner acts.
      first.keyDown("ArrowDown");
      expect(first.snapshot().focus).toBe("b");
      expect(second.snapshot().focus).toBe("a");

      // Touching the other canvas hands input over — pressing nothing in
      // particular is still using that view.
      second.pointer.click(1, 1);
      first.keyDown("ArrowDown");

      expect(first.snapshot().focus).toBe("b");
      expect(second.snapshot().focus).toBe("b");
    } finally {
      second.dispose();
    }
  });

  it("lets exactly one view poll the pad, and hands it over with the keyboard", async () => {
    const first = await mountEnvelope(TWO_BUTTONS);
    const _view = first;
    const second = await mountEnvelope(TWO_BUTTONS, { share: first });
    try {
      const pad = first.connectGamepad();

      pad.press(13); // d-pad down
      first.advance(16);
      expect(first.snapshot().focus).toBe("b");
      expect(second.snapshot().focus).toBe("a");

      pad.release(13);
      first.advance(16);
      second.pointer.click(1, 1);
      pad.press(13);
      first.advance(16);

      // `navigator.getGamepads()` belongs to the page, so the stick moves one
      // focus, not one per canvas.
      expect(first.snapshot().focus).toBe("b");
      expect(second.snapshot().focus).toBe("b");
    } finally {
      second.dispose();
    }
  });
});

describe("text size (ZAB-69)", () => {
  function label(fontSize: number, text = "A"): object {
    return {
      v: 1,
      tokens: {},
      views: { big: { type: "Text", id: "big", text, style: { fontSize } } },
    };
  }

  it("clamps a runaway fontSize instead of rasterizing hundreds of megabytes", async () => {
    // 20000px asks the rasterizer for a ~14000² coverage buffer (~200 MB) and
    // then throws "out of WASM memory" — from the measure pass, inside render(),
    // called from an event handler with nobody to catch it. The clamp is what
    // stands between an author's animated token and a dead view.
    const runaway = await mountEnvelope(label(20_000));
    const rect = node(runaway.snapshot(), "big").rect;
    const warnings = [...runaway.warnings];
    runaway.dispose();

    // Laid out at the ceiling — the same view as if 512 had been declared.
    const view = await mountEnvelope(label(512));
    expect(rect).toEqual(node(view.snapshot(), "big").rect);
    expect(warnings).toEqual([]);
  });

  it("wraps a Text once and reuses the lines while nothing about it changes", async () => {
    const view = await mountEnvelope(label(16, "una etiqueta que no cambia"));
    // The wrap walks the run through the atlas; a frame that reuses the block
    // does not touch it at all.
    const advance = vi.spyOn(GlyphAtlas.prototype, "advance");

    view.settle();
    view.settle();

    expect(advance).not.toHaveBeenCalled();
    advance.mockRestore();
  });
});

describe("author errors", () => {
  it("warns once about an unknown token and paints the missing-color magenta", async () => {
    const view = await mountEnvelope({
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

  /**
   * The console is where a structured diagnostic went to die (ZAB-72): the dev
   * server's overlay, the preview and the editor cannot scrape it, so what the
   * validator knows — the code, the path — never reached the one place it was
   * addressed to. `onDiagnostic` is that channel.
   */
  it("hands the load's diagnostics to onDiagnostic instead of the console", async () => {
    const seen: Diagnostic[] = [];
    const view = await mountEnvelope(
      {
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
      },
      { onDiagnostic: (diagnostic) => seen.push(diagnostic) },
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].level).toBe("warn");
    expect(seen[0].code).toBe("unknown-token");
    expect(seen[0].path).toBe('views["broken"].style.background');
    expect(view.warnings).toEqual([]);
  });

  it("routes a refused hot-update through onDiagnostic, keeping the view on screen", async () => {
    const seen: Diagnostic[] = [];
    const view = await mountEnvelope(ENVELOPE_ONE_VIEW, {
      onDiagnostic: (diagnostic) => seen.push(diagnostic),
    });

    view.handle.reload({ ...ENVELOPE_ONE_VIEW, v: 99 });

    // Reported with its code, not swallowed — and the previous UI is untouched:
    // a bad hot-update costs an update, never a session (ZAB-37).
    expect(seen.map((d) => [d.level, d.code])).toEqual([["fatal", "unsupported-version"]]);
    expect(view.warnings).toEqual([]);
    expect(node(view.snapshot(), "hud")).toBeTruthy();
  });
});

/** Two envelopes that share nothing but their shape — the reload swaps view sets. */
const ENVELOPE_ONE_VIEW = {
  v: 1,
  tokens: {},
  views: { hud: { type: "Container", id: "hud", layout: { width: 10, height: 10 } } },
};

const ENVELOPE_TWO_VIEWS = {
  v: 1,
  tokens: {},
  views: {
    menu: { type: "Container", id: "menu", layout: { width: 10, height: 10 } },
    pause: { type: "Container", id: "pause", layout: { width: 10, height: 10 } },
  },
};

describe("the handle's view list", () => {
  /**
   * It used to be `Object.keys(...)` evaluated ONCE, when the handle was made, so
   * a caller that hot-updated kept listing the views of the envelope before the
   * save — the preview's view picker among them (ZAB-72).
   */
  it("follows the envelope across a reload", async () => {
    const view = await mountEnvelope(ENVELOPE_ONE_VIEW);
    const { handle } = view;
    expect(handle.viewIds).toEqual(["hud"]);

    handle.reload(ENVELOPE_TWO_VIEWS);

    expect(handle.viewIds).toEqual(["menu", "pause"]);
    // And the view on screen is the fallback the reload picked, since "hud" is gone.
    expect(node(view.snapshot(), "menu")).toBeTruthy();
  });

  it("keeps the old list when the update was refused", async () => {
    const view = await mountEnvelope(ENVELOPE_ONE_VIEW);
    const { handle } = view;

    handle.reload({ ...ENVELOPE_TWO_VIEWS, v: 99 });

    expect(handle.viewIds).toEqual(["hud"]);
  });
});

describe("GPU robustness (ZAB-68)", () => {
  it("submits nothing while the context is lost, and repaints when it comes back", async () => {
    const view = await mountForTest(CORPUS["states-tokens"]);
    const before = view.drawCalls();
    expect(before).toBeGreaterThan(0);

    view.loseContext();
    // A frame asked for while the context is down produces no draw call at all —
    // in a browser those calls are silent no-ops on dead objects.
    view.settle();
    expect(view.drawCalls()).toBe(before);

    view.restoreContext();

    // The restored context comes back EMPTY: without this repaint the canvas
    // would stay blank until something else happened to ask for a frame.
    expect(view.drawCalls()).toBeGreaterThan(before);
    expect(view.warnings).toEqual([]);
  });

  it("keeps taking input after a restore — the tree outlived the context", async () => {
    const view = await mountForTest(CORPUS["states-tokens"]);
    const target = center(view.snapshot(), "primary");

    view.loseContext();
    view.restoreContext();
    view.pointer.click(target.x, target.y);

    expect(view.actions).toEqual([{ action: "buy" }]);
  });

  it("ignores calls on a disposed view instead of driving dead GL objects", async () => {
    const disposed = await mountCase(CORPUS["states-tokens"]);
    const _view = disposed;
    const drawn = disposed.drawCalls();
    disposed.handle.dispose();

    expect(() => {
      disposed.handle.setData("player.coins", 1);
      disposed.handle.setText("primary", "nope");
      disposed.handle.reload(readEnvelope(CORPUS["states-tokens"].envelope));
      // A second dispose (React strict mode does exactly this) is a no-op too.
      disposed.handle.dispose();
    }).not.toThrow();

    expect(disposed.drawCalls()).toBe(drawn);
    // Warned ONCE: a game looping over a stale handle must not flood the console.
    expect(disposed.warnings).toHaveLength(1);
    expect(disposed.warnings[0]).toContain("disposed view");
  });
});

/**
 * A list of groups, each with a list of its own — the shape that pins the
 * expansion ORDER (ZAB-73). Expanding the outer list is what builds the inner
 * ones, so whatever drives the pass has to reach a `Repeat` that did not exist
 * when the pass started.
 */
const NESTED_REPEATS = {
  v: 1,
  views: {
    groups: {
      type: "Container",
      layout: { direction: "column", align: "start" },
      children: [
        {
          type: "Repeat",
          id: "groups",
          items: { bind: "shop.groups" },
          as: "group",
          key: "id",
          layout: { direction: "column", align: "start" },
          children: [
            {
              type: "Container",
              layout: { direction: "column", align: "start" },
              children: [
                { type: "Text", text: { bind: "group.name" } },
                {
                  type: "Repeat",
                  items: { bind: "group.items" },
                  as: "item",
                  key: "id",
                  layout: { direction: "column", align: "start" },
                  children: [{ type: "Text", text: { bind: "item.name" } }],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

const GROUPS = [
  {
    id: "g1",
    name: "Armas",
    items: [
      { id: "i1", name: "Espada" },
      { id: "i2", name: "Arco" },
    ],
  },
  { id: "g2", name: "Pociones", items: [{ id: "i3", name: "Vida" }] },
];

describe("where the canvas is (ZAB-73)", () => {
  it("re-reads the canvas rect when the page scrolls under it", async () => {
    const view = await mountForTest(CORPUS["states-tokens"]);
    const target = center(view.snapshot(), "primary");
    // The rect is cached — `getBoundingClientRect` flushes layout and a pointer
    // move asked for it twice — so a page that scrolls has to say so.
    view.moveCanvas(0, -40);
    view.scrollPage();

    // The control is where it always was in the VIEW; what moved is the page
    // coordinate it answers to.
    view.pointer.click(target.x, target.y - 40);

    expect(view.actions).toEqual([{ action: "buy" }]);
  });

  it("re-reads it when the canvas itself is resized", async () => {
    const view = await mountForTest(CORPUS["states-tokens"]);
    view.moveCanvas(0, -40);
    // The other way a mounted view learns it moved: it was resized. A canvas that
    // changed size has very likely changed place too.
    view.resize(480, 320);
    const target = center(view.snapshot(), "primary");

    view.pointer.click(target.x, target.y - 40);

    expect(view.actions).toEqual([{ action: "buy" }]);
  });
});

describe("nested Repeats (ZAB-31, expansion order pinned in ZAB-73)", () => {
  it("expands the inner lists the outer one just created, in the same pass", async () => {
    const view = await mountEnvelope(NESTED_REPEATS, { data: { "shop.groups": GROUPS } });

    // One frame: the inner lists must not need a SECOND one to appear, or every
    // nested list in a UI would flash empty on the frame its group arrives.
    const texts = allTexts(view.snapshot());
    expect(texts).toEqual(["Armas", "Espada", "Arco", "Pociones", "Vida"]);
  });

  it("follows the data when a group's items change under it", async () => {
    const view = await mountEnvelope(NESTED_REPEATS, { data: { "shop.groups": GROUPS } });

    view.handle.setData("shop.groups", [
      { id: "g1", name: "Armas", items: [{ id: "i9", name: "Daga" }] },
    ]);
    view.settle();

    expect(allTexts(view.snapshot())).toEqual(["Armas", "Daga"]);
  });
});

/** Every `Text` of the tree, in document order — what the rows say. */
function allTexts(snapshot: ViewSnapshot): string[] {
  const found: string[] = [];
  const walk = (node: NodeSnapshot): void => {
    if (node.type === "Text" && node.text) {
      found.push(node.text.lines.map((line) => line.text).join(" "));
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(snapshot.tree);
  return found;
}
describe("mount → dispose → mount, over and over (ZAB-74)", () => {
  /**
   * The dev loop's own shape: a preview server that reloads, a React component
   * that remounts, an editor that swaps documents. Nothing here is a single
   * frame's behavior — it is what a view must leave behind, which only shows up
   * as an afternoon of slow accumulation unless a test counts it.
   */
  it("leaves nothing behind: no listener, no frame, no timer", async () => {
    const mounted = await mountCase(CORPUS.overlays);
    const busy = mounted.held();
    // Really mounted: listening on the page and the canvas, with the toast's
    // `autoCloseMs` armed.
    expect(busy.listeners).toBeGreaterThan(0);
    expect(busy.timers).toBeGreaterThan(0);

    mounted.dispose();

    expect(mounted.held()).toEqual({ listeners: 0, frames: 0, timers: 0 });
  });

  it("takes the caret's own timer down with it (ZAB-73)", async () => {
    const mounted = await mountCase(CORPUS.textinput);
    const field = findNode(mounted.snapshot(), "name")?.rect;
    if (!field) throw new Error("the name field is not on screen");
    mounted.pointer.click(field.x + 4, field.y + field.height / 2);
    // A focused field asks for the frame its caret next flips on — a pending
    // timer of a kind that did not exist before ZAB-73, and one a disposed view
    // must not leave armed any more than an `autoCloseMs`.
    expect(mounted.held().timers).toBeGreaterThan(0);

    mounted.dispose();

    expect(mounted.held()).toEqual({ listeners: 0, frames: 0, timers: 0 });
  });

  it("holds no more after ten cycles than after one", async () => {
    const cycles: Array<{ listeners: number; frames: number; timers: number }> = [];
    for (const _ of Array(10).keys()) {
      const cycle = await mountCase(CORPUS.settings);
      // Read while it is UP: a leak that survives disposal shows up in the next
      // cycle's own count, which is the number that grows.
      cycles.push(cycle.held());
      cycle.dispose();
      expect(cycle.held()).toEqual({ listeners: 0, frames: 0, timers: 0 });
    }
    for (const held of cycles) expect(held).toEqual(cycles[0]);
  });

  it("comes back up whole: focus, input and the data channel all live again", async () => {
    const first = await mountCase(CORPUS.controls);
    const focused = first.snapshot().focus;
    first.dispose();

    const view = await mountForTest(CORPUS.controls);

    expect(view.snapshot().focus).toBe(focused);
    // Not just standing there: the keyboard reaches it and the writes flow.
    view.keyDown("ArrowDown");
    expect(view.snapshot().focus).not.toBe(focused);
    expect(view.warnings).toEqual([]);
  });

  it("hands the input back to the view still standing", async () => {
    const first = await mountEnvelope(TWO_BUTTONS);
    const _view = first;
    const second = await mountEnvelope(TWO_BUTTONS, { share: first });
    try {
      // The owner is the first view; disposing it must not leave the page with
      // nobody listening (ZAB-70) — the survivor takes the keyboard.
      second.pointer.click(1, 1);
      second.dispose();
      first.keyDown("ArrowDown");

      expect(first.snapshot().focus).toBe("b");
    } finally {
      // Already disposed above; a second one is the no-op React strict mode does.
      second.dispose();
    }
  });

  it("does not run a frame the disposed view had already scheduled", async () => {
    const mounted = await mountCase(CORPUS.transitions);
    const _view = mounted;
    // A transition in flight: there IS a frame pending when the view goes down.
    mounted.handle.setData("job.progress", 0.9);
    expect(mounted.held().frames).toBeGreaterThan(0);
    const drawn = mounted.drawCalls();

    mounted.dispose();
    mounted.advance(400);

    expect(mounted.drawCalls()).toBe(drawn);
  });
});

/**
 * `MountOptions.dpr` and `MountOptions.onFrame` (ZAB-78) — the two things a host
 * needs to show a UI as another screen would, and to say what that costs.
 */
describe("device pixel ratio", () => {
  it("renders at the page's ratio when nothing overrides it", async () => {
    const view = await mountForTest(CORPUS["states-tokens"], { width: 800, height: 600 });

    // The harness's page reports dpr 1, which is what the corpus was recorded at.
    expect(view.canvasSize()).toEqual({ width: 800, height: 600 });
  });

  it("sizes the backing store by the forced ratio instead", async () => {
    const view = await mountForTest(CORPUS["states-tokens"], { width: 800, height: 600, dpr: 2 });

    expect(view.canvasSize()).toEqual({ width: 1600, height: 1200 });
  });

  it("keeps the LOGICAL size, so the same UI is laid out either way", async () => {
    // Sequentially, not side by side: each mount installs its own stand-in page.
    const atOne = await mountForTest(CORPUS["states-tokens"], { width: 800, height: 600, dpr: 1 });
    const rectAtOne = node(atOne.snapshot(), "primary").rect;
    atOne.dispose();

    const atTwo = await mountForTest(CORPUS["states-tokens"], { width: 800, height: 600, dpr: 2 });

    // DPR is how many device pixels a logical one is drawn with — it is not a
    // different viewport. A rect that moved would mean layout had leaked into it.
    expect(node(atTwo.snapshot(), "primary").rect).toEqual(rectAtOne);
  });

  it("survives a ratio the page could never report", async () => {
    const view = await mountForTest(CORPUS["states-tokens"], { dpr: 0.5 });

    expect(view.snapshot()).toBeTruthy();
  });
});

describe("onFrame", () => {
  it("reports every frame the view actually painted, with what it cost", async () => {
    const frames: Array<{ drawCalls: number; ms: number }> = [];
    const _view = await mountForTest(CORPUS["states-tokens"], {
      onFrame: (stats) => frames.push({ drawCalls: stats.drawCalls, ms: stats.ms }),
    });

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.at(-1)?.drawCalls).toBeGreaterThan(0);
    expect(frames.at(-1)?.ms).toBeGreaterThanOrEqual(0);
  });

  it("agrees with stats(), which is the same frame read the other way", async () => {
    const frames: Array<FrameStats & { ms: number }> = [];
    const view = await mountForTest(CORPUS["states-tokens"], {
      onFrame: (stats) => {
        frames.push(stats);
      },
    });
    const last = frames.at(-1) ?? null;

    // `stats()` answers "what did the last frame cost"; `onFrame` answers "when".
    // They must never be two different numbers for one frame.
    expect(last).not.toBeNull();
    const { ms, ...counters } = last as unknown as FrameStats & { ms: number };
    expect(typeof ms).toBe("number");
    expect(counters).toEqual(view.handle.stats());
  });

  it("is what a frame RATE can be built from — polling stats() cannot", async () => {
    // The renderer paints on demand: a still scene paints nothing at all, so a
    // caller's own rAF would be measuring the page and not the renderer.
    const painted: true[] = [];
    const view = await mountForTest(CORPUS["states-tokens"], {
      onFrame: () => {
        painted.push(true);
      },
    });
    const afterMount = painted.length;

    view.advance(500);

    // Nothing is animating, so nothing was painted — and that IS the answer.
    expect(painted.length).toBe(afterMount);
    expect(view.handle.stats().drawCalls).toBeGreaterThan(0);
  });
});
