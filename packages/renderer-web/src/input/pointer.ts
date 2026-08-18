/**
 * Pointer wiring (extracted from `view.ts` in ZAB-54): the canvas listeners for
 * press, drag, wheel and hover, and the gesture state that spans them — which
 * control took the pointer down, and what a move therefore means. `hit.ts` and
 * `overlay.ts` own the pure hit-testing rules; this owns the gestures that run
 * on top of them, and hands every resolved intention (activate, focus, scroll,
 * slider value, caret) back to the handler that owns it.
 */

import { clipContains } from "../clip.js";
import type { FieldEditor } from "../controls/field.js";
import { effectiveClip } from "../hit.js";
import { contains, inLayout, type LayoutNode } from "../layout.js";
import { type Point, resolveHit } from "../overlay.js";
import type { OverlayLayer } from "../overlays/layer.js";
import { caretAt } from "../textinput.js";

/** In-progress pointer drag on a ScrollView, before the click-vs-drag threshold resolves it. */
interface ScrollDrag {
  node: LayoutNode;
  startPoint: { x: number; y: number };
  lastPoint: { x: number; y: number };
  moved: boolean;
}

/** Below this many px of pointer travel, a gesture still counts as a click/tap. */
const DRAG_THRESHOLD = 4;

/**
 * A Slider gesture in flight (pointer or held arrow key). `from` is the value it
 * started at: `onCommit` is "the value the player settled on", so a gesture that
 * ends where it began fires nothing.
 */
export interface SliderGesture {
  node: LayoutNode;
  from: number;
}

/**
 * The slice of the view the pointer reads: the canvas it listens on, the tree it
 * hit-tests, and the handlers its resolved intentions land in — the same ones
 * the keyboard and the gamepad go through.
 */
export interface PointerHost {
  readonly canvas: HTMLCanvasElement;
  /** The player touched this view: it takes the keyboard and the pad (ZAB-70). */
  claimInput(): void;
  root(): LayoutNode;
  layer(): readonly LayoutNode[];
  radiusOf(node: LayoutNode): number;
  isFocusable(node: LayoutNode): boolean;
  /** The Collapse-header rule: the first child of a Collapse toggles it. */
  isCollapseHeader(node: LayoutNode): boolean;
  setFocus(node: LayoutNode | null): void;
  activate(node: LayoutNode): void;
  setCollapseOpen(node: LayoutNode, open: boolean): void;
  setSliderValue(node: LayoutNode, value: number): void;
  valueAtPoint(node: LayoutNode, point: Point): number;
  commitSlider(gesture: SliderGesture): void;
  setScrollOffset(node: LayoutNode, x: number, y: number): void;
  /** Registers the listeners' cleanup with the view's disposers. */
  addDisposer(dispose: () => void): void;
  render(): void;
}

/** The canvas listeners and the pointer's own gesture state. */
export class PointerHandler {
  /** Node whose press the pointer holds, pending a release over it. */
  private pressedNode: LayoutNode | null = null;
  /** Node under the mouse, if any — the only state the pointer owns by itself. */
  private hoveredNode: LayoutNode | null = null;
  private scrollDrag: ScrollDrag | null = null;
  /** Slider being dragged with the pointer. */
  private sliderDrag: SliderGesture | null = null;
  /** TextInput whose selection the pointer is dragging out. */
  private textDrag: LayoutNode | null = null;
  /** Overlay whose backdrop took the pointer down, pending a release on it. */
  private backdropPress: LayoutNode | null = null;
  /**
   * Where the canvas sits on the page, cached (ZAB-73). `getBoundingClientRect`
   * flushes pending layout, and `eventPoint` was calling it up to twice per
   * `pointermove` — a hover and a drag both resolve a point — so dragging a
   * Slider forced the browser's layout a hundred times a second.
   *
   * What can move it under us is a scroll or a resize, and both are listened for
   * below; the view invalidates it too when its own canvas is resized.
   */
  private bounds: { left: number; top: number } | null = null;

  constructor(
    private readonly host: PointerHost,
    private readonly field: FieldEditor,
    private readonly overlays: OverlayLayer,
  ) {}

  hovered(): LayoutNode | null {
    return this.hoveredNode;
  }

  pressed(): LayoutNode | null {
    return this.pressedNode;
  }

  /** Whether this Slider is riding a pointer drag right now. */
  isSliderDragging(node: LayoutNode): boolean {
    return this.sliderDrag?.node === node;
  }

  /** Drops the hover when the node it lit up left the layout. */
  pruneHover(): void {
    if (this.hoveredNode && !inLayout(this.hoveredNode)) this.setHover(null);
  }

  /**
   * Releases the hover, the press and any value gesture riding a node the game
   * has just disabled (ZAB-63). A slider drag is **cancelled**, not committed:
   * the value never settled, which is the same rule as a press that ends outside
   * its control. A scroll drag survives on purpose — a disabled section is still
   * readable, so scrolling it was never an interaction it owned.
   */
  pruneDisabled(): void {
    if (this.hoveredNode?.disabled) this.setHover(null);
    if (this.pressedNode?.disabled) {
      this.pressedNode.pressed = false;
      this.pressedNode = null;
    }
    if (this.sliderDrag?.node.disabled) {
      this.sliderDrag.node.pressed = false;
      this.sliderDrag = null;
    }
    if (this.textDrag?.disabled) this.textDrag = null;
  }

  /** A released node's identity dies with it: any gesture it anchored goes too. */
  forget(node: LayoutNode): void {
    if (this.pressedNode === node) this.pressedNode = null;
    if (this.backdropPress === node) this.backdropPress = null;
    if (this.scrollDrag?.node === node) this.scrollDrag = null;
    if (this.sliderDrag?.node === node) this.sliderDrag = null;
  }

  /** A rebuild: the tree is new, so every gesture that referenced it is gone. */
  reset(): void {
    this.pressedNode = null;
    this.hoveredNode = null;
    this.scrollDrag = null;
    this.sliderDrag = null;
    this.textDrag = null;
    this.backdropPress = null;
  }

  listen(): void {
    const down = (event: PointerEvent) => {
      // Touching a view is what hands it the keyboard and the pad, whatever the
      // press lands on — pressing nothing is still using this view (ZAB-70).
      this.host.claimInput();
      const point = this.eventPoint(event);
      const resolved = this.hitTest(point);
      if (resolved.kind === "backdrop") {
        // A tap on a modal's backdrop: dismissed on release, like a button click.
        this.backdropPress = resolved.overlay;
        this.host.canvas.setPointerCapture(event.pointerId);
        return;
      }
      const hit = resolved.kind === "node" ? resolved.node : null;
      // Sliders take the pointer first: the gesture starts on the press (the
      // thumb jumps to the finger) and the control lives inside scrollable
      // screens, where the drag must move the value, not the list.
      // Every control predicate below refuses a disabled node, and refusing means
      // the press falls THROUGH to what is behind it: a dead button inside a
      // scroller does not swallow the drag that scrolls the list (ZAB-63).
      const slider = hit && this.findUp(hit, (n) => n.ir.type === "Slider" && !n.disabled);
      if (slider) {
        this.sliderDrag = { node: slider, from: slider.sliderValue };
        slider.pressed = true;
        this.host.setFocus(slider);
        this.host.canvas.setPointerCapture(event.pointerId);
        this.host.setSliderValue(slider, this.host.valueAtPoint(slider, point));
        this.host.render();
        return;
      }
      // A text field takes the pointer for the same reason a Slider does: the press
      // places the caret and the drag selects, and neither may become a scroll of
      // the screen the field sits in.
      const field = hit && this.findUp(hit, (n) => n.ir.type === "TextInput" && !n.disabled);
      if (field) {
        this.textDrag = field;
        this.host.setFocus(field);
        this.field.focusEditor(field); // the canvas press blurs the hidden field: take it back
        this.host.canvas.setPointerCapture(event.pointerId);
        this.field.setSelection(field, caretAt(this.field.textIndexAt(field, point)));
        return;
      }
      const pressable =
        hit &&
        this.findUp(hit, (n) => (n.ir.type === "Button" || n.ir.type === "Toggle") && !n.disabled);
      if (pressable) {
        pressable.pressed = true;
        this.pressedNode = pressable;
        this.host.setFocus(pressable); // pointer and directional nav share one focus
        this.host.canvas.setPointerCapture(event.pointerId);
        this.host.render();
        return;
      }
      // Not yet a scroll gesture — held back until the drag threshold clears
      // it, so a plain tap still reaches the Collapse-toggle handling in `up`.
      const scrollable = hit && this.findUp(hit, (n) => n.ir.type === "ScrollView");
      if (scrollable) {
        this.scrollDrag = {
          node: scrollable,
          startPoint: point,
          lastPoint: point,
          moved: false,
        };
        this.host.canvas.setPointerCapture(event.pointerId);
      }
    };
    const move = (event: PointerEvent) => {
      // Hover is a MOUSE state: a finger that taps and leaves would otherwise
      // keep a control lit up with nothing over it.
      if (event.pointerType === "" || event.pointerType === "mouse") {
        if (this.setHover(this.hoverableAt(this.eventPoint(event)))) this.host.render();
      }
      const slider = this.sliderDrag;
      if (slider) {
        // No drag threshold: a slider follows the finger from the first pixel
        // (there is no tap-vs-drag ambiguity — the press already set a value).
        this.host.setSliderValue(
          slider.node,
          this.host.valueAtPoint(slider.node, this.eventPoint(event)),
        );
        return;
      }
      const field = this.textDrag;
      if (field) {
        // The anchor stays where the press landed and the focus follows the
        // pointer — the same `{anchor, focus}` a shift+arrow moves.
        this.field.setSelection(field, {
          anchor: field.selection.anchor,
          focus: this.field.textIndexAt(field, this.eventPoint(event)),
        });
        return;
      }
      const drag = this.scrollDrag;
      if (!drag) return;
      const point = this.eventPoint(event);
      if (!drag.moved) {
        const dx = point.x - drag.startPoint.x;
        const dy = point.y - drag.startPoint.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.moved = true;
      }
      const dx = point.x - drag.lastPoint.x;
      const dy = point.y - drag.lastPoint.y;
      drag.lastPoint = point;
      this.host.setScrollOffset(
        drag.node,
        drag.node.scrollOffset.x - dx,
        drag.node.scrollOffset.y - dy,
      );
    };
    const up = (event: PointerEvent) => {
      const point = this.eventPoint(event);
      if (this.textDrag) {
        this.textDrag = null;
        return;
      }
      const slider = this.sliderDrag;
      if (slider) {
        this.sliderDrag = null;
        slider.node.pressed = false;
        this.host.render();
        this.host.commitSlider(slider);
        return;
      }
      const pressed = this.pressedNode;
      if (pressed) {
        pressed.pressed = false;
        this.pressedNode = null;
        this.host.render();
        // Released over the control it pressed — and still inside the clip, so
        // scrolling the button out from under the finger cancels the tap.
        if (this.reachableAt(pressed, point)) this.host.activate(pressed);
        return;
      }
      const backdrop = this.backdropPress;
      this.backdropPress = null;
      if (backdrop) {
        const resolved = this.hitTest(point);
        if (resolved.kind === "backdrop" && resolved.overlay === backdrop) {
          this.overlays.requestDismiss(backdrop);
        }
        return;
      }
      const drag = this.scrollDrag;
      this.scrollDrag = null;
      if (drag?.moved) return; // a scroll gesture, not a tap
      // Collapse header toggle (the <details>/<summary> model).
      const resolved = this.hitTest(point);
      const hit = resolved.kind === "node" ? resolved.node : null;
      const header = hit && this.findUp(hit, (n) => this.host.isCollapseHeader(n) && !n.disabled);
      if (header?.parent) this.host.setCollapseOpen(header.parent, !header.parent.open);
    };
    const wheel = (event: WheelEvent) => {
      const resolved = this.hitTest(this.eventPoint(event));
      if (resolved.kind === "backdrop") {
        event.preventDefault(); // the modal captures the wheel: nothing below scrolls
        return;
      }
      const hit = resolved.kind === "node" ? resolved.node : null;
      const scrollable = hit && this.findUp(hit, (n) => n.ir.type === "ScrollView");
      if (!scrollable) return;
      event.preventDefault();
      this.host.setScrollOffset(
        scrollable,
        scrollable.scrollOffset.x + event.deltaX,
        scrollable.scrollOffset.y + event.deltaY,
      );
    };
    const leave = () => {
      if (this.setHover(null)) this.host.render();
    };

    const canvas = this.host.canvas;
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    // The pointer can also END without a release: a touch interrupted by the
    // system, a browser gesture taking over, a lost `pointerId`. Without this the
    // gesture would live forever — a Button frozen `pressed`, a Slider still
    // tracking the next move that reaches the canvas (ZAB-70).
    canvas.addEventListener("pointercancel", this.cancel);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    // The two things that move the canvas without touching it: the page scrolling
    // under it and the window resizing. Captured, so a scroll inside any
    // container on the way up counts, and passive — this only drops a cache.
    const invalidate = this.invalidateBounds;
    globalThis.addEventListener?.("scroll", invalidate, { capture: true, passive: true });
    globalThis.addEventListener?.("resize", invalidate, { passive: true });
    this.host.addDisposer(() => {
      globalThis.removeEventListener?.("scroll", invalidate, { capture: true });
      globalThis.removeEventListener?.("resize", invalidate);
    });
    this.host.addDisposer(() => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", this.cancel);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
    });
  }

  /**
   * Every gesture ends, and none of them CONCLUDES: no action fires, no backdrop
   * is dismissed, no Collapse toggles — the same "released outside the control"
   * rule a pointer that wanders off already follows.
   *
   * The Slider is the one exception, and settles: its value is on screen and was
   * written into its bound path on every move, so refusing `onCommit` would leave
   * the game without the "apply the expensive thing" event for a value the player
   * really did leave there. Same reading as a pad unplugged mid-nudge (ZAB-47).
   */
  private readonly cancel = (): void => {
    const slider = this.sliderDrag;
    if (slider) {
      this.sliderDrag = null;
      slider.node.pressed = false;
    }
    if (this.pressedNode) {
      this.pressedNode.pressed = false;
      this.pressedNode = null;
    }
    this.textDrag = null;
    this.scrollDrag = null;
    this.backdropPress = null;
    this.host.render();
    if (slider) this.host.commitSlider(slider);
  };

  /** The cached canvas rect is stale: a scroll, a resize, a new canvas size. */
  invalidateBounds = (): void => {
    this.bounds = null;
  };

  private eventPoint(event: PointerEvent | WheelEvent): { x: number; y: number } {
    let bounds = this.bounds;
    if (bounds === null) {
      const rect = this.host.canvas.getBoundingClientRect();
      bounds = { left: rect.left, top: rect.top };
      this.bounds = bounds;
    }
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  /** The overlay layer first (top-down, a modal captures), then the tree — clipped subtrees excluded. */
  private hitTest(point: Point) {
    return resolveHit(this.host.root(), this.host.layer(), point, (n) => this.host.radiusOf(n));
  }

  /**
   * The control the pointer is over, if any. Hoverable is the same set as
   * focusable — what takes input is what may look different under the pointer —
   * so hover and directional navigation light up exactly the same nodes, and a
   * modal's backdrop (which captures input) lights up nothing below it.
   */
  private hoverableAt(point: Point): LayoutNode | null {
    const resolved = this.hitTest(point);
    if (resolved.kind !== "node") return null;
    return this.findUp(resolved.node, (node) => this.host.isFocusable(node));
  }

  /** Moves the hover, returning whether anything changed (the caller repaints). */
  private setHover(node: LayoutNode | null): boolean {
    if (this.hoveredNode === node) return false;
    if (this.hoveredNode) this.hoveredNode.hovered = false;
    this.hoveredNode = node;
    if (node) node.hovered = true;
    return true;
  }

  /** Is this node's own rect reachable at that point, given its ancestors' clips? */
  private reachableAt(node: LayoutNode, point: Point): boolean {
    return (
      contains(node.rect, point) &&
      clipContains(
        effectiveClip(node, (n) => this.host.radiusOf(n)),
        point,
      )
    );
  }

  /**
   * Nearest ancestor matching `predicate`, stopping at an `Overlay`: a layer
   * entry is the top of its own input scope, so a gesture inside a modal never
   * reaches the ScrollView or Collapse it happens to be declared inside.
   */
  private findUp(node: LayoutNode, predicate: (n: LayoutNode) => boolean): LayoutNode | null {
    let current: LayoutNode | null = node;
    while (current) {
      if (current.ir.type === "Overlay") return null;
      if (predicate(current)) return current;
      current = current.parent;
    }
    return null;
  }
}
