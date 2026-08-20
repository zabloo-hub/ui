import type { ZNode } from "@zabloo/format";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLayoutNode, type LayoutNode, type Rect } from "../layout.js";
import type { TextMetrics } from "../text.js";
import { caretAt, insert, selectAll } from "../textinput.js";
import { CARET, FieldEditor, type FieldHost } from "./field.js";

/**
 * `FieldEditor` against its own seam (ZAB-74). `textinput.ts` owns the editing
 * MODEL — caret math, `maxLength`, the single-line rule — and has its own suite;
 * this owns the STATE that runs it: which node is being edited, the hidden
 * `<textarea>` the browser types into, and the two-way fold between them.
 *
 * The hidden field is the part worth testing here and not through `view.ts`: it
 * outlives the tree it is editing, so what happens when a composition, a
 * truncation or a rebuild lands out of order is a property of this module alone.
 */

/** Monospace stand-in: every glyph advances 10px, so an expected x stays readable. */
const FONT: TextMetrics = {
  advance: () => 10,
  kern: () => 0,
  lineHeight: 20,
  ascent: 16,
};

/** The content box every field below measures against — 100px of visible text. */
const BOX: Rect = { x: 20, y: 0, width: 100, height: 20 };

function field(ir: Partial<ZNode> = {}): LayoutNode {
  return createLayoutNode({ type: "TextInput", ...ir } as ZNode);
}

interface Rig {
  editor: FieldEditor;
  /** Nodes the host was told an edit had settled on, in order. */
  edited: LayoutNode[];
  renders: number;
  /** The hidden field, once the editor asked the document for one. */
  textarea(): FakeTextarea | null;
  /** Disposers the editor registered — what `dispose()` on the view would run. */
  disposers: Array<() => void>;
  focus(node: LayoutNode | null): void;
}

/**
 * A `FieldEditor` with the focus under the test's control and a stand-in
 * `document` that hands out the one element this module creates.
 */
function rig(): Rig {
  let focused: LayoutNode | null = null;
  const edited: LayoutNode[] = [];
  const disposers: Array<() => void> = [];
  let created: FakeTextarea | null = null;

  const host: FieldHost = {
    focused: () => focused,
    metrics: () => FONT,
    contentBox: () => BOX,
    textEdited: (node) => edited.push(node),
    attachEditor: () => {},
    addDisposer: (dispose) => disposers.push(dispose),
    render: () => {
      state.renders++;
    },
  };

  installDocument(() => {
    created = new FakeTextarea();
    return created;
  });

  const state: Rig = {
    editor: new FieldEditor(host),
    edited,
    renders: 0,
    textarea: () => created,
    disposers,
    focus: (node) => {
      focused = node;
    },
  };
  return state;
}

/**
 * The one element this module ever creates. Only what `field.ts` touches is
 * here — anything else it reached for would fail loudly instead of silently
 * working against a full DOM implementation.
 */
class FakeTextarea {
  value = "";
  selectionStart = 0;
  selectionEnd = 0;
  selectionDirection: "forward" | "backward" | "none" = "none";
  spellcheck = true;
  tabIndex = 0;
  readonly style: Record<string, string> = {};
  readonly attributes: Record<string, string> = {};
  removed = false;
  focused = false;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    this.listeners.set(type, set);
    set.add(listener);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  remove(): void {
    this.removed = true;
  }
  focus(): void {
    this.focused = true;
    active = this as unknown as Element;
  }
  blur(): void {
    this.focused = false;
    if (active === (this as unknown as Element)) active = null;
  }
  setSelectionRange(start: number, end: number, direction: "forward" | "backward"): void {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }
  /** How many listeners are still hooked up — a leak shows up as a number that never drops. */
  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, set) => total + set.size, 0);
  }
  /** The browser reporting what it did to the text: value, caret, then the event. */
  edit(value: string, caret = value.length, direction: "forward" | "backward" = "forward"): void {
    this.value = value;
    this.selectionStart = direction === "backward" ? caret : caret;
    this.selectionEnd = caret;
    this.selectionDirection = direction;
    this.dispatch("input");
  }
  dispatch(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({});
  }
}

/** What `document.activeElement` reports — the editor reads it before focusing. */
let active: Element | null = null;

function installDocument(create: () => FakeTextarea): void {
  active = null;
  vi.stubGlobal("document", {
    createElement: () => create(),
    get activeElement() {
      return active;
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  active = null;
});

describe("the buffer", () => {
  it("keeps `empty` in step with the text — it is what styles the placeholder", () => {
    const state = rig();
    const node = field();

    state.editor.setNodeText(node, "hola");
    expect([node.text, node.empty]).toEqual(["hola", false]);

    state.editor.setNodeText(node, "");
    expect([node.text, node.empty]).toEqual(["", true]);
  });

  it("tells the game once per real change, and never for a no-op", () => {
    const state = rig();
    const node = field();

    state.editor.applyEdit(node, { text: "hola", selection: caretAt(4) });
    expect(state.edited).toEqual([node]);

    // Same text, different caret: the player moved, the VALUE did not.
    state.editor.applyEdit(node, { text: "hola", selection: caretAt(1) });
    expect(state.edited).toEqual([node]);
    expect(node.selection).toEqual(caretAt(1));
  });

  it("clamps a caret the edit put past the end of its own text", () => {
    const state = rig();
    const node = field();

    state.editor.applyEdit(node, { text: "hi", selection: { anchor: 0, focus: 99 } });

    expect(node.selection).toEqual({ anchor: 0, focus: 2 });
  });

  it("restarts the blink on every edit, so the caret stays solid while typing", () => {
    const state = rig();
    const node = field();
    expect(node.caretSince).toBeNull();

    state.editor.applyEdit(node, { text: "a", selection: caretAt(1) });
    const first = node.caretSince;
    expect(first).not.toBeNull();

    state.editor.setSelection(node, caretAt(0));
    expect(node.caretSince).not.toBeNull();
    expect(node.caretSince).toBeGreaterThanOrEqual(first as number);
  });

  it("deletes forward and backward from the caret", () => {
    const state = rig();
    const node = field();
    state.editor.setNodeText(node, "hola");

    node.selection = caretAt(2);
    state.editor.deleteText(node, false);
    expect(node.text).toBe("hla");

    state.editor.deleteText(node, true);
    expect(node.text).toBe("ha");
  });
});

describe("a composition in flight", () => {
  /**
   * The rule the module exists for: while an IME is composing, the field SHOWS
   * what is being typed but the game is not told — half a syllable is not a
   * value — and `compositionend` is what commits it.
   */
  it("shows what is being composed without reporting it", () => {
    const state = rig();
    const node = field();

    state.editor.applyEdit(node, { text: "か", selection: caretAt(1) }, true);

    expect(node.text).toBe("か");
    expect(state.edited).toEqual([]);
  });

  it("commits the settled text even though the buffer already had it", () => {
    const state = rig();
    const node = field();

    state.editor.applyEdit(node, { text: "か", selection: caretAt(1) }, true);
    // Same text as the last silent frame: without `commit` this would be a no-op
    // and the value the player composed would never reach the game.
    state.editor.applyEdit(node, { text: "か", selection: caretAt(1) }, false, true);

    expect(state.edited).toEqual([node]);
  });
});

describe("the hidden field", () => {
  it("is created off-screen, focusable and out of the assistive tree", () => {
    const state = rig();
    const node = field();
    state.focus(node);

    state.editor.focusEditor(node);

    const editor = state.textarea();
    expect(editor).not.toBeNull();
    // Off-screen but REAL: `display:none` takes no focus, and without focus there
    // is no composition and no virtual keyboard.
    expect(editor?.style.position).toBe("fixed");
    expect(editor?.style.opacity).toBe("0");
    expect(editor?.attributes["aria-hidden"]).toBe("true");
    expect(editor?.spellcheck).toBe(false);
    expect(editor?.tabIndex).toBe(-1);
    expect(editor?.focused).toBe(true);
  });

  it("is made once and reused across focuses", () => {
    const state = rig();
    const first = field();
    const second = field();

    state.focus(first);
    state.editor.focusEditor(first);
    const editor = state.textarea();

    state.focus(second);
    state.editor.focusEditor(second);

    expect(state.textarea()).toBe(editor);
    expect(state.disposers).toHaveLength(1);
  });

  it("takes no keyboard for a node that is not a TextInput", () => {
    const state = rig();
    const button = createLayoutNode({ type: "Button" });

    state.editor.focusEditor(button);

    // Nothing was even created: a Button never types.
    expect(state.textarea()).toBeNull();
  });

  it("gives the keyboard back when the focus leaves the field", () => {
    const state = rig();
    const node = field();
    state.focus(node);
    state.editor.focusEditor(node);
    expect(state.textarea()?.focused).toBe(true);

    state.focus(null);
    state.editor.focusEditor(null);

    expect(state.textarea()?.focused).toBe(false);
  });

  it("mirrors the buffer and the caret into it, with the selection's direction", () => {
    const state = rig();
    const node = field();
    state.focus(node);
    state.editor.setNodeText(node, "hola");
    state.editor.focusEditor(node);

    state.editor.setSelection(node, { anchor: 4, focus: 1 });

    const editor = state.textarea();
    expect(editor?.value).toBe("hola");
    // Anchor after focus is a selection dragged leftwards: the browser has to be
    // told, or shift+arrow would grow it from the wrong end.
    expect([editor?.selectionStart, editor?.selectionEnd]).toEqual([1, 4]);
    expect(editor?.selectionDirection).toBe("backward");
  });

  it("counts the caret in code points, not UTF-16 units", () => {
    const state = rig();
    const node = field();
    state.focus(node);
    state.editor.setNodeText(node, "🎮🎮");
    state.editor.focusEditor(node);

    state.editor.setSelection(node, caretAt(1));

    // One emoji is one caret step for the model and two units for the browser.
    expect(state.textarea()?.selectionStart).toBe(2);
  });

  it("does not fight an IME for the element it is composing in", () => {
    const state = rig();
    const node = field();
    state.focus(node);
    state.editor.focusEditor(node);
    const editor = state.textarea() as FakeTextarea;

    editor.dispatch("compositionstart");
    editor.value = "か";
    // The model's own text is still the pre-composition one; syncing would wipe
    // what the IME has half-written into the element.
    state.editor.setSelection(node, caretAt(0));

    expect(editor.value).toBe("か");
  });
});

describe("folding the browser's edit back in", () => {
  it("runs whatever the browser did through the editing model", () => {
    const state = rig();
    const node = field();
    state.focus(node);
    state.editor.focusEditor(node);

    // Typing, pasting, autocorrect: it all arrives as "this is the new value".
    (state.textarea() as FakeTextarea).edit("hola mundo");

    expect(node.text).toBe("hola mundo");
    expect(node.selection).toEqual(caretAt(10));
    expect(state.edited).toEqual([node]);
  });

  it("applies `maxLength` to a paste and writes the truncation back to the browser", () => {
    const state = rig();
    const node = field({ maxLength: 4 } as Partial<ZNode>);
    state.focus(node);
    state.editor.focusEditor(node);
    const editor = state.textarea() as FakeTextarea;

    editor.edit("hola mundo");

    expect(node.text).toBe("hola");
    // The browser's copy is no longer ours: left alone, the next keystroke would
    // arrive on top of the text the model already refused.
    expect(editor.value).toBe("hola");
    expect(editor.selectionStart).toBe(4);
  });

  it("keeps the game out of it until the composition ends", () => {
    const state = rig();
    const node = field();
    state.focus(node);
    state.editor.focusEditor(node);
    const editor = state.textarea() as FakeTextarea;

    editor.dispatch("compositionstart");
    editor.value = "か";
    editor.dispatch("compositionupdate");

    expect(node.text).toBe("か");
    expect(state.edited).toEqual([]);

    editor.dispatch("compositionend");

    expect(state.edited).toEqual([node]);
  });

  it("reads a backward selection as one, so shift+arrow keeps its end", () => {
    const state = rig();
    const node = field();
    state.focus(node);
    state.editor.focusEditor(node);
    const editor = state.textarea() as FakeTextarea;

    editor.value = "hola";
    editor.selectionStart = 1;
    editor.selectionEnd = 4;
    editor.selectionDirection = "backward";
    editor.dispatch("input");

    expect(node.selection).toEqual({ anchor: 4, focus: 1 });
  });

  it("ignores an event for a node that no longer holds the keyboard", () => {
    const state = rig();
    const node = field();
    state.focus(node);
    state.editor.focusEditor(node);
    const editor = state.textarea() as FakeTextarea;

    state.focus(createLayoutNode({ type: "Button" }));
    editor.edit("ghost");

    expect(node.text).toBe("");
    expect(state.edited).toEqual([]);
  });
});

describe("a rebuild under the field (ZAB-57)", () => {
  /**
   * The hidden field OUTLIVES the tree — it belongs to the canvas, not to the
   * document on it. Without `reset` a `compositionend` arriving after a hot
   * reload would commit half a syllable into a node nobody is showing any more.
   */
  it("drops the composition it was in the middle of", () => {
    const state = rig();
    const node = field();
    state.focus(node);
    state.editor.focusEditor(node);
    const editor = state.textarea() as FakeTextarea;
    editor.dispatch("compositionstart");

    state.editor.reset();
    editor.dispatch("compositionend");

    expect(state.edited).toEqual([]);
  });

  it("hands the keyboard back, so the field is not still holding it", () => {
    const state = rig();
    const node = field();
    state.focus(node);
    state.editor.focusEditor(node);

    state.editor.reset();

    expect(state.textarea()?.focused).toBe(false);
  });

  it("survives a reset with no field ever created", () => {
    expect(() => rig().editor.reset()).not.toThrow();
  });
});

describe("disposal", () => {
  it("unhooks every listener and takes the element out of the page", () => {
    const state = rig();
    const node = field();
    state.focus(node);
    state.editor.focusEditor(node);
    const editor = state.textarea() as FakeTextarea;
    expect(editor.listenerCount()).toBe(4);

    for (const dispose of state.disposers) dispose();

    expect(editor.listenerCount()).toBe(0);
    expect(editor.removed).toBe(true);
  });

  it("builds a fresh element when the view comes back up", () => {
    const state = rig();
    const node = field();
    state.focus(node);
    state.editor.focusEditor(node);
    const first = state.textarea();

    for (const dispose of state.disposers) dispose();
    state.editor.focusEditor(node);

    expect(state.textarea()).not.toBe(first);
  });
});

describe("the field's own horizontal scroll", () => {
  /** Text long enough that only part of it fits in `BOX` (10px per glyph, 100px wide). */
  const LONG = "0123456789abcdef";

  it("stays at zero while everything fits", () => {
    const state = rig();
    const node = field();
    state.editor.setNodeText(node, "corto");
    node.selection = caretAt(5);

    state.editor.syncTextScroll(node);

    expect(node.textScroll).toBe(0);
  });

  it("follows a caret that ran off the right edge", () => {
    const state = rig();
    const node = field();
    state.editor.setNodeText(node, LONG);
    node.selection = caretAt(16);

    state.editor.syncTextScroll(node);

    // 160px of text, a 100px box: the caret sits at the right edge, its own
    // width included, so the bar the player is looking at is not half cut.
    expect(node.textScroll).toBe(160 - 100 + CARET.width);
  });

  it("comes back with a caret that walked off the left edge", () => {
    const state = rig();
    const node = field();
    state.editor.setNodeText(node, LONG);
    node.selection = caretAt(16);
    state.editor.syncTextScroll(node);

    node.selection = caretAt(0);
    state.editor.syncTextScroll(node);

    expect(node.textScroll).toBe(0);
  });

  it("is idempotent — it runs after every arrange", () => {
    const state = rig();
    const node = field();
    state.editor.setNodeText(node, LONG);
    node.selection = caretAt(12);

    state.editor.syncTextScroll(node);
    const once = node.textScroll;
    state.editor.syncTextScroll(node);

    expect(node.textScroll).toBe(once);
  });
});

describe("the caret a pointer lands on", () => {
  it("reads the point in the field's own content coordinates", () => {
    const state = rig();
    const node = field();
    state.editor.setNodeText(node, "hola");

    // BOX starts at x=20, glyphs advance 10: the seam after "ho" is at 40.
    expect(state.editor.textIndexAt(node, { x: 41, y: 0 })).toBe(2);
    expect(state.editor.textIndexAt(node, { x: 20, y: 0 })).toBe(0);
  });

  it("counts the field's scroll in, so a scrolled field is not off by a word", () => {
    const state = rig();
    const node = field();
    state.editor.setNodeText(node, "0123456789abcdef");
    node.textScroll = 60;

    // The same screen x now names a character six glyphs further in.
    expect(state.editor.textIndexAt(node, { x: 41, y: 0 })).toBe(8);
  });
});

describe("the editing model is the one `view.ts` also goes through", () => {
  it("uses the same replacement the browser's edit is folded through", () => {
    // Guards the seam itself: `readEditor` runs the whole value through `insert`
    // over `selectAll`, which is what makes a paste obey the same `maxLength`
    // that a keystroke does. If those diverged, one path would truncate and the
    // other would not.
    expect(insert("hola", selectAll("hola"), "hola mundo", 4).text).toBe("hola");
  });
});
