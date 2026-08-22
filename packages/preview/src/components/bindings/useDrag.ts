/**
 * Dragging the bindings panel around the stage, with pointer events and nothing
 * else. No DnD library: one card, one handle, one axis-free translation — the
 * whole thing is a pointer offset and a clamp, and a library would be more
 * surface than the feature.
 *
 * Two positions, not one. `panelPos` in the store is what SURVIVES a reload; the
 * `live` position here is what the card is drawn at right now. The store is
 * written once, on release, rather than on every move — a persisted field taking
 * sixty writes a second would put `localStorage` in the middle of a drag. The
 * two also diverge on purpose when the window is resized: the card is pulled
 * back inside the stage without persisting, because a resize is a statement
 * about the window and not about where you put the panel.
 *
 * `null` is the default corner (14px in from the top-right) rather than a
 * computed `{x, y}`: expressed as `right`, it stays in its corner across every
 * resize for free, and it is the value a press on the grip goes back to.
 *
 * That reset fires from the `pointerup`, not from the grip's `click`, and that is
 * not a preference. The header captures the pointer at the press so a fast drag
 * cannot outrun the handle, and with a capture active the browser retargets the
 * derived `click` to the element that captured — the header — so the grip's own
 * handler never runs. The press that started on the grip and never travelled is
 * the reset, and the release is the last moment that still knows both things.
 *
 * Which leaves the grip's `click` to the keyboard alone, and that is the whole
 * of its job: no pointer sequence needs it, so it does not have to tell a drag's
 * trailing click apart from a real one and no state has to survive the gesture
 * to help it.
 */

import {
  type CSSProperties,
  type PointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PanelPos } from "@/store/layout";

/** How far the default corner sits from the stage's top-right, in px. */
const INSET = 14;

/**
 * Pointer travel below which a press still reads as a click, in px. Without it,
 * one pixel of trackpad jitter during a click marks the sequence as a drag and
 * silently swallows the grip's reset.
 */
const DRAG_THRESHOLD = 4;

interface Size {
  width: number;
  height: number;
}

/** The press in flight: where it started, and whether it can still be a reset. */
interface Grab {
  /** Where inside the card the pointer went down. */
  offset: PanelPos;
  /** Where on the screen — what the threshold measures travel against. */
  from: PanelPos;
  /** Started on the grip, so a release that never moved goes back to the corner. */
  fromGrip: boolean;
}

interface DragHandleProps {
  onPointerDown(event: PointerEvent<HTMLElement>): void;
  onPointerMove(event: PointerEvent<HTMLElement>): void;
  onPointerUp(event: PointerEvent<HTMLElement>): void;
  onPointerCancel(event: PointerEvent<HTMLElement>): void;
}

interface Drag {
  /** Goes on the card: it is what gets measured and moved. */
  ref: RefObject<HTMLDivElement | null>;
  /** The card's `position` offsets — the default corner, or px from the stage. */
  style: CSSProperties;
  dragging: boolean;
  /** Spread on whatever starts a drag (the header, grip included). */
  handleProps: DragHandleProps;
  /**
   * Spread on the grip's own `onPointerDown`. It arms the reset for this one
   * sequence and then lets the press bubble on to the header, which starts the
   * drag from the grip exactly as it would from anywhere else in the header.
   */
  pressReset(event: PointerEvent<HTMLElement>): void;
  /** Back to the default corner — where the grip's press ends up. */
  reset(): void;
}

/**
 * The card's top-left, kept inside the stage. A stage SMALLER than the card
 * pins it at the origin instead of pushing it off the left edge: `0` is the
 * corner you can still grab it by.
 */
function clamp(pos: PanelPos, card: Size, stage: Size): PanelPos {
  return {
    x: bound(pos.x, stage.width - card.width),
    y: bound(pos.y, stage.height - card.height),
  };
}

function bound(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

interface Bounds {
  card: DOMRect;
  stage: DOMRect;
}

/**
 * The card and the box it is positioned inside, measured together.
 *
 * `offsetParent` is the containing block the card's `left`/`top` are actually
 * resolved against, so it is the honest answer; `parentElement` is the fallback
 * for the one environment that has no layout to report — jsdom, where the tests
 * stub these rects and `offsetParent` is always null.
 */
function measure(card: HTMLElement): Bounds | null {
  const stage = card.offsetParent ?? card.parentElement;
  if (!(stage instanceof HTMLElement)) return null;
  return { card: card.getBoundingClientRect(), stage: stage.getBoundingClientRect() };
}

function useDrag(pos: PanelPos | null, commit: (pos: PanelPos | null) => void): Drag {
  const ref = useRef<HTMLDivElement | null>(null);
  // The press in flight. A ref rather than state: it changes once per drag and
  // no render depends on it.
  const grab = useRef<Grab | null>(null);
  // Set by the grip's own handler and read by the header's an instant later,
  // when the same press bubbles up. Cleared there so a sequence that aborts
  // before it becomes a drag cannot leave the next one armed.
  const armed = useRef(false);
  // Whether this sequence moved — the difference between a drag to commit and a
  // press to answer. Same reason it is a ref: nothing renders from it.
  const moved = useRef(false);
  const [live, setLive] = useState<PanelPos | null>(null);
  const [dragging, setDragging] = useState(false);

  const at = live ?? pos;

  // The latest drawn position, readable from the one stable listener below —
  // subscribing on `at` would re-attach it on every frame of a drag.
  const atRef = useRef<PanelPos | null>(null);
  useEffect(() => {
    atRef.current = at;
  });

  useEffect(() => {
    const reclamp = (): void => {
      const card = ref.current;
      const current = atRef.current;
      if (card === null || current === null) return;
      const bounds = measure(card);
      if (bounds === null) return;
      // A stage with no size is not a layout to clamp against — a hidden stage
      // (and jsdom before the tests stub the rects) would pin the card to the
      // origin and persist the accident on the next release.
      if (bounds.stage.width === 0 || bounds.stage.height === 0) return;
      const inside = clamp(current, bounds.card, bounds.stage);
      if (inside.x !== current.x || inside.y !== current.y) setLive(inside);
    };
    // On mount too, not only on resize: a persisted position was saved against
    // another window, and restoring it verbatim can draw the card off-stage
    // with nothing to bring it back until the window happens to resize.
    reclamp();
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, []);

  const reset = (): void => {
    moved.current = false;
    setLive(null);
    commit(null);
  };

  const release = (event: PointerEvent<HTMLElement>): void => {
    if (!dragging) return;
    const seized = grab.current;
    const handle = event.currentTarget;
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    grab.current = null;
    setDragging(false);
    // The release is where the reset has to happen: the capture taken at the
    // press means the `click` this sequence ends in is delivered to the header,
    // never to the grip.
    if (!moved.current && seized?.fromGrip === true) {
      reset();
      return;
    }
    // A press that never moved is not a reposition, and must not overwrite the
    // default corner with a computed one.
    if (live !== null) commit(live);
  };

  const handleProps: DragHandleProps = {
    onPointerDown: (event) => {
      const fromGrip = armed.current;
      armed.current = false;
      const card = ref.current;
      if (event.button !== 0 || card === null) return;
      const bounds = measure(card);
      if (bounds === null) return;
      grab.current = {
        offset: {
          x: event.clientX - bounds.card.left,
          y: event.clientY - bounds.card.top,
        },
        from: { x: event.clientX, y: event.clientY },
        fromGrip,
      };
      // So a drag cannot outrun the handle: without it, a pointer that leaves
      // the header — which it does the moment the clamp stops the card against
      // an edge — stops delivering moves and the drag stalls mid-gesture.
      // Optional because jsdom implements no capture at all.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      moved.current = false;
      setDragging(true);
    },

    onPointerMove: (event) => {
      const card = ref.current;
      const seized = grab.current;
      if (!dragging || card === null || seized === null) return;
      // Until the pointer has really travelled, the sequence is still a click.
      // Once it has, it stays a drag — no flicker back inside the threshold.
      if (
        !moved.current &&
        Math.hypot(event.clientX - seized.from.x, event.clientY - seized.from.y) < DRAG_THRESHOLD
      ) {
        return;
      }
      const bounds = measure(card);
      if (bounds === null) return;
      moved.current = true;
      setLive(
        clamp(
          {
            x: event.clientX - bounds.stage.left - seized.offset.x,
            y: event.clientY - bounds.stage.top - seized.offset.y,
          },
          bounds.card,
          bounds.stage,
        ),
      );
    },

    onPointerUp: release,
    onPointerCancel: release,
  };

  return {
    ref,
    style: at === null ? { top: INSET, right: INSET } : { left: at.x, top: at.y },
    dragging,
    handleProps,
    pressReset: (event) => {
      armed.current = event.button === 0;
    },
    reset,
  };
}

export type { Drag, DragHandleProps };
export { clamp, INSET, useDrag };
