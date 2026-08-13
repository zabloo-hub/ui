/**
 * Overlay layer wiring (ZAB-19/ZAB-46/ZAB-25, extracted from `view.ts` in
 * ZAB-54): the modal stack and its focus bookkeeping, dismiss requests, the
 * enter/exit presence tween, anchoring, popovers and `autoCloseMs`.
 * `overlay.ts` owns the pure rules (what is modal, where an anchored box lands,
 * what the layer contains); this owns the state that runs them frame to frame,
 * keyed by node identity.
 */

import { arrange, inLayout, type LayoutNode, type Rect } from "../layout.js";
import {
  ANCHOR_OFFSET,
  anchorBox,
  anchorSpec,
  deflate,
  isModal,
  isOnScreen,
  isPressTriggered,
  isWithin,
  overlaySpec,
  stepPresence,
} from "../overlay.js";
import { createNodeAnim, type NodeAnim, type ResolvedTransition } from "../transition.js";

/**
 * The slice of the view the layer reads: the tree and the live layer, the focus
 * machinery a modal interrupts, and the return leg of the data channel when a
 * dismiss writes `visible` back.
 */
export interface OverlayHost {
  /** The root of the built tree — every Overlay hangs somewhere under it. */
  root(): LayoutNode;
  /** The live layer, as the last render collected it. */
  layer(): readonly LayoutNode[];
  /** The node that owns the keyboard, if any. */
  focused(): LayoutNode | null;
  /** The view's id → node index, for anchors. */
  nodeById(id: string): LayoutNode | undefined;
  /** Where focus may live right now: the top modal's subtree, or the root. */
  scope(): LayoutNode;
  isFocusable(node: LayoutNode): boolean;
  autofocus(scope: LayoutNode): LayoutNode | null;
  setFocus(node: LayoutNode | null): void;
  /** Write `false` into the overlay's bound `visible` path — the return leg of the data channel. */
  closeVisible(overlay: LayoutNode): void;
  /** Fire the overlay's `onDismiss`, with the overlay's own action context. */
  dismissed(overlay: LayoutNode, action: string): void;
  transitionOf(node: LayoutNode): ResolvedTransition | null;
  /** A presence tween is still moving: keep the frame loop alive. */
  markAnimating(): void;
  radiusOf(node: LayoutNode): number;
  dim(value: unknown, fallback: number): number;
  render(): void;
}

/**
 * The state the overlay layer keeps between frames, all keyed by node identity:
 * which modal interrupted which focus, each overlay's presence tween, and the
 * `autoCloseMs` timers that are armed.
 */
export class OverlayLayer {
  /** Open modals, innermost last, each with the focus it interrupted. */
  private readonly modalStack: Array<{ overlay: LayoutNode; previousFocus: LayoutNode | null }> =
    [];
  /** Live `autoCloseMs` timers, keyed by the overlay they will dismiss. */
  private readonly autoCloseTimers = new Map<LayoutNode, ReturnType<typeof setTimeout>>();
  /**
   * The enter/exit fade of each Overlay, kept OUT of the node's own `NodeAnim`:
   * the resolve pass drops that one when a node leaves layout, and an exit whose
   * starting point is erased by the exit itself would never animate.
   */
  private readonly anims = new Map<LayoutNode, NodeAnim>();
  /** This frame's presence per overlay (absent = 0, nothing to paint). */
  private readonly presence = new Map<LayoutNode, number>();
  /** Overlays already out of the live layer but still fading — pixels, never input. */
  private readonly exiting = new Set<LayoutNode>();
  /** Anchor ids already reported as missing — the warning is per author error, not per frame. */
  private warnedAnchors = new Set<string>();

  constructor(private readonly host: OverlayHost) {}

  /** This frame's presence of an overlay — what the paint fades it by. */
  presenceOf(overlay: LayoutNode): number {
    return this.presence.get(overlay) ?? 1;
  }

  /** Out of the live layer but still fading: it paints, and nothing else. */
  isExiting(node: LayoutNode): boolean {
    return this.exiting.has(node);
  }

  /** Whether anything is still fading out — when false, the live layer IS the paint layer. */
  anyExiting(): boolean {
    return this.exiting.size > 0;
  }

  /**
   * A released node's identity dies with it: its tween, its place in the modal
   * stack, and the focus restore that pointed at it.
   */
  forget(node: LayoutNode): void {
    this.anims.delete(node);
    for (let i = this.modalStack.length - 1; i >= 0; i--) {
      if (this.modalStack[i].overlay === node) this.modalStack.splice(i, 1);
      else if (this.modalStack[i].previousFocus === node) this.modalStack[i].previousFocus = null;
    }
  }

  /** A rebuild: the tree is new, so every node identity this state referenced is gone. */
  reset(): void {
    this.warnedAnchors = new Set();
    this.modalStack.length = 0;
    this.clearAutoClose();
    // Presence dies with the document, like every other tween: a reload snaps.
    this.anims.clear();
    this.presence.clear();
    this.exiting.clear();
  }

  /**
   * Keeps focus inside the layer's rules across relayouts: an opening modal
   * remembers the focus it interrupts and hands it to its `autofocus`, and a
   * closing one gives that focus back. Runs on every render — the single funnel
   * every state change already goes through — so it never misses an overlay
   * opened by a binding, a reload or the game.
   */
  syncModalFocus(): void {
    const modals = this.host.layer().filter(isModal);

    // Gone from the layer (closed or hidden): the OUTERMOST one that left owns
    // the restore, so closing a whole stack returns to what preceded all of it.
    let restored: LayoutNode | null = null;
    for (let i = this.modalStack.length - 1; i >= 0; i--) {
      if (modals.includes(this.modalStack[i].overlay)) continue;
      restored = this.modalStack[i].previousFocus;
      this.modalStack.splice(i, 1);
    }
    for (const modal of modals) {
      if (this.modalStack.some((entry) => entry.overlay === modal)) continue;
      this.modalStack.push({ overlay: modal, previousFocus: this.host.focused() });
      restored = null; // opening wins over closing: the new modal owns the focus
    }

    const scope = this.host.scope();
    const current = this.host.focused();
    if (current && inLayout(current) && isWithin(current, scope)) return;
    // Outside the scope (or gone): the restored node if it still qualifies,
    // otherwise the scope's `autofocus` — and nothing at all if neither does,
    // rather than leaving a node under the modal wearing the focused state.
    const candidate =
      restored && inLayout(restored) && this.host.isFocusable(restored) && isWithin(restored, scope)
        ? restored
        : this.host.autofocus(scope);
    this.host.setFocus(candidate);
  }

  /**
   * A dismiss request — Escape, a tap on the backdrop, an `autoCloseMs` timeout.
   * Closing is the renderer's default behavior: it writes `false` into the bound
   * `visible` path (the read/write binding mechanism of decision 2026-08-11,
   * which also notifies the game) and fires the declared `onDismiss` action.
   * With a static `visible` there is nothing to write — only the action fires,
   * and closing is the game's call.
   */
  requestDismiss(overlay: LayoutNode): void {
    const spec = overlaySpec(overlay);
    if (spec === null) return;
    // A popover's open state is the SDK's, so closing it is a flag and NOT a write
    // into the game's data: `visible` never held it open in the first place.
    if (isPressTriggered(overlay)) {
      overlay.popoverOpen = false;
    } else {
      this.host.closeVisible(overlay);
    }
    if (spec.onDismiss) this.host.dismissed(overlay, spec.onDismiss);
    this.host.render();
  }

  /**
   * The layer's enter/exit fade: one presence tween per Overlay of the view,
   * whether it is up or not — a hidden one has to sit at 0 so that opening it is a
   * change to animate from, instead of the snap a first observation would give.
   *
   * The tween runs on the overlay's OWN `transition`, so this adds no IR surface:
   * without one, presence jumps and the frame looks exactly like it did before F7.
   */
  syncPresence(now: number): void {
    this.presence.clear();
    this.exiting.clear();
    const layer = this.host.layer();
    this.eachOverlay(this.host.root(), (overlay) => {
      let anim = this.anims.get(overlay);
      if (!anim) {
        anim = createNodeAnim();
        this.anims.set(overlay, anim);
      }
      const live = layer.includes(overlay);
      const stepped = stepPresence(anim, live, this.host.transitionOf(overlay), now);
      if (stepped.animating) this.host.markAnimating();
      // Recorded even at 0 — the frame an overlay opens on starts there, and a
      // missing entry would paint it fully opaque for exactly that frame, which
      // reads as a flash right before the fade in.
      this.presence.set(overlay, stepped.value);
      // Out of the live layer but still visible: it paints, and nothing else. It
      // takes no input, traps no focus and re-arms no timer, because every one of
      // those reads the live layer, which it already left.
      if (!live && stepped.value > 0) this.exiting.add(overlay);
    });
  }

  /** Every Overlay of the tree, hidden ones included — presence is tracked for all. */
  private eachOverlay(node: LayoutNode, visit: (overlay: LayoutNode) => void): void {
    if (node.ir.type === "Overlay") visit(node);
    for (const child of node.children) this.eachOverlay(child, visit);
  }

  // --- anchoring (decision 2026-08-11, ZAB-46) ---

  /**
   * The node an overlay is anchored to. An `id` that resolves to nothing is
   * authoring error, not runtime state: it warns once (repeating it every frame
   * would bury the console) and the overlay falls back to the layer placement it
   * still carries, so a typo shows a v1 tooltip instead of nothing at all.
   */
  private anchorNode(id: string): LayoutNode | null {
    const node = this.host.nodeById(id);
    if (node) return node;
    if (!this.warnedAnchors.has(id)) {
      this.warnedAnchors.add(id);
      console.warn(`[zabloo] Overlay anchor "${id}" matches no node in this view`);
    }
    return null;
  }

  /**
   * The layer's predicate: in layout, and — for an anchored overlay — with its
   * anchor still on screen and, when it rides its hover, under the pointer or the
   * focus. Everything the layer owns (input, focus, timers, the presence tween's
   * target) reads it through the live layer, so the two capabilities of ZAB-46
   * need no wiring of their own anywhere else.
   */
  layerPresent = (node: LayoutNode): boolean => inLayout(node) && this.anchorAllows(node);

  private anchorAllows(node: LayoutNode): boolean {
    const spec = anchorSpec(node);
    if (spec === null) return true;
    const anchor = this.anchorNode(spec.id);
    if (anchor === null) return true;
    if (!isOnScreen(anchor, (n) => this.host.radiusOf(n))) return false;
    if (spec.trigger === "manual") return true;
    // Hover lights up exactly the focusable set (decision 2026-08-11, ZAB-36), so
    // an anchor that takes no input is never hovered NOR focused and the hint
    // would simply never appear. A popover has the same problem for the same
    // reason: a node that takes no press can never be pressed to open it.
    if (!this.host.isFocusable(anchor) && !this.warnedAnchors.has(spec.id)) {
      this.warnedAnchors.add(spec.id);
      console.warn(
        `[zabloo] Overlay anchor "${spec.id}" is a ${anchor.ir.type}, which takes no ` +
          `input: a trigger:"${spec.trigger}" overlay anchored to it never shows.`,
      );
    }
    // A popover is up while the SDK's own open flag says so — the one piece of
    // overlay state that is not `visible` (decision 2026-08-12, ZAB-25).
    if (spec.trigger === "press") return node.popoverOpen;
    return anchor.hovered || anchor.focused;
  }

  // --- popovers (`anchor.trigger: "press"` — decision 2026-08-12, ZAB-25) ---

  /**
   * The popovers a node anchors, whatever their `visible` says right now: the
   * press toggles the flag, and the layer predicate decides what that means. Any
   * number of them, because `anchor.id` is a plain reference and nothing stops two
   * overlays from hanging off one button.
   */
  private popoversOf(anchor: LayoutNode): LayoutNode[] {
    const id = (anchor.ir as { id?: string }).id;
    if (id === undefined) return [];
    const found: LayoutNode[] = [];
    this.eachOverlay(this.host.root(), (overlay) => {
      const spec = anchorSpec(overlay);
      if (spec?.trigger === "press" && spec.id === id) found.push(overlay);
    });
    return found;
  }

  /**
   * Pressing the anchor toggles its popovers — the same press that opens a
   * dropdown closes it, so a trigger button behaves like one. Returns whether it
   * had any, so the caller knows the press meant something beyond its action.
   */
  togglePopovers(anchor: LayoutNode): boolean {
    const popovers = this.popoversOf(anchor);
    for (const popover of popovers) popover.popoverOpen = !popover.popoverOpen;
    return popovers.length > 0;
  }

  /** Closes the popover this node lives in, if any — what a selection inside does. */
  closeEnclosingPopover(node: LayoutNode): void {
    for (let current: LayoutNode | null = node; current; current = current.parent) {
      if (current.ir.type === "Overlay" && isPressTriggered(current)) {
        current.popoverOpen = false;
        return;
      }
    }
  }

  /**
   * Lays one layer entry out. Unanchored, the entry IS the view: its own flex
   * places the content anywhere on the layer. Anchored, the content goes where
   * `anchorBox` puts it around the anchor, while the entry's own rect stays the
   * view's — that is what keeps a modal popover dimming and capturing the whole
   * screen while its panel hangs off a button.
   *
   * The content is sized from `natural`, so `layout.width`/`height` on an Overlay
   * stay ignored (a layer is not sized — size the child), and `padding` keeps
   * meaning "margin from the view's edges": it is taken out of the box and given
   * back around it, so the same number does the same job anchored or not.
   */
  arrangeOverlay(overlay: LayoutNode, viewRect: Rect): void {
    const spec = anchorSpec(overlay);
    const anchor = spec === null ? null : this.anchorNode(spec.id);
    if (spec === null || anchor === null) {
      arrange(overlay, viewRect);
      return;
    }
    const padding = overlay.resolved.padding ?? 0;
    const box = anchorBox(
      anchor.rect,
      { x: overlay.natural.x - padding * 2, y: overlay.natural.y - padding * 2 },
      spec.at,
      this.host.dim(spec.offset, ANCHOR_OFFSET),
      deflate(viewRect, padding),
    );
    arrange(overlay, {
      x: box.x - padding,
      y: box.y - padding,
      width: box.width + padding * 2,
      height: box.height + padding * 2,
    });
    overlay.rect = viewRect;
  }

  /**
   * Arms `autoCloseMs` while an overlay is in the layer; disarms it when it leaves.
   * Never for a hover-triggered one: what dismisses that is leaving the anchor, and
   * a timer would take the hint away from under a pointer still resting on it.
   */
  syncAutoClose(): void {
    const layer = this.host.layer();
    for (const [overlay, timer] of this.autoCloseTimers) {
      if (layer.includes(overlay)) continue;
      clearTimeout(timer);
      this.autoCloseTimers.delete(overlay);
    }
    for (const overlay of layer) {
      const ms = overlaySpec(overlay)?.autoCloseMs;
      if (ms === undefined || this.autoCloseTimers.has(overlay)) continue;
      if (anchorSpec(overlay)?.trigger === "hover") continue;
      const timer = setTimeout(() => {
        this.autoCloseTimers.delete(overlay);
        this.requestDismiss(overlay);
      }, ms);
      this.autoCloseTimers.set(overlay, timer);
    }
  }

  clearAutoClose(): void {
    for (const timer of this.autoCloseTimers.values()) clearTimeout(timer);
    this.autoCloseTimers.clear();
  }
}
