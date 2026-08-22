/**
 * Who gets the keys — the page's own focus first, and then which mounted view
 * (ZAB-70, ZAB-109).
 *
 * The pointer is scoped by construction — its listeners live on the canvas — but
 * the keys and the pad are not: `keydown` is a window event and
 * `navigator.getGamepads()` is a property of the page, so two views mounted side
 * by side would EACH move their own focus on every arrow and both consume the
 * same pad. That asymmetry was the bug.
 *
 * There are two questions, and they are asked in this order:
 *
 * 1. **Does the page's focus leave the keys to the renderer at all?**
 *    (`focusYieldsKeys`.) A view is not alone on the page: around the canvas
 *    there are buttons, tabs and fields that belong to the host, and Enter on
 *    one of them is the browser's to turn into a click. Answered from the DOM
 *    focus, which is why the predicate is here and the reading is in `view.ts`.
 * 2. **Which mounted view is it, when the focus points at none in particular?**
 *    (`ownsInput`.) The last view the player TOUCHED, with the first one mounted
 *    owning input until anybody touches anything — so a page with a single view
 *    behaves exactly as if the rule did not exist.
 *
 * The second question is deliberately NOT "the view whose canvas has DOM focus":
 * the keys have to keep flowing while the focus sits on nothing at all, which is
 * where a page starts, and a view that never got a click would otherwise be
 * mute. The first question is what makes the two agree — a canvas that takes the
 * DOM focus claims input on the way in.
 */

/** A view that can own input. The registry only ever asks it to re-check its pad. */
interface InputView {
  /** Start or stop this view's pad poll loop to match what it now owns. */
  syncPad(): void;
}

/** Mounted views, in mount order — the head is the default owner. */
const views: InputView[] = [];
/** Who owns input right now. A slot: this module IS the process-wide singleton. */
const current: { owner: InputView | null } = { owner: null };

/** A view that has just mounted. The first one to arrive owns input. */
function registerView(view: InputView): void {
  views.push(view);
  if (current.owner === null) setOwner(view);
}

/** A view that has been disposed: ownership falls back to the oldest one left. */
function unregisterView(view: InputView): void {
  const index = views.indexOf(view);
  if (index >= 0) views.splice(index, 1);
  if (current.owner === view) setOwner(views[0] ?? null);
}

/**
 * The player touched this view — a pointer down on its canvas — so it takes the
 * keyboard and the pad. A view that is not mounted claims nothing.
 */
function claimInput(view: InputView): void {
  if (current.owner === view || !views.includes(view)) return;
  setOwner(view);
}

function ownsInput(view: InputView): boolean {
  return current.owner === view;
}

/**
 * Where the page's focus is, from a view's point of view: what holds it, and the
 * two elements that ARE this view.
 *
 * Pure on purpose — the DOM read (`document.activeElement`) belongs to `view.ts`
 * and the rule belongs here, testable without a browser like `gamepad.ts` is.
 */
interface KeyFocus {
  /** `document.activeElement` — whoever the page is handing the keys to. */
  active: unknown;
  /** The view's canvas: the focus being on it IS the player being in the game. */
  canvas: unknown;
  /** The hidden field a focused `TextInput` types through, if one exists yet. */
  editor: unknown;
  /** The page's `<body>`: parked here, the focus is on nothing in particular. */
  body: unknown;
}

/**
 * Whether the page's focus leaves this view's keys alone to read (ZAB-109).
 *
 * The renderer listens on the window, so it hears every key the page gets —
 * including the Enter meant for a button of the host's own chrome. Reading it is
 * harmless; `preventDefault()` is not, and that is the actual damage: the
 * browser never turns that Enter into a click and the button cannot be pressed
 * without a mouse. So the keys are the view's only while the focus is on
 * something of the view's, or on nothing at all.
 *
 * The hidden `<textarea>` counts as the view. It has to live OUTSIDE the canvas
 * (a canvas cannot compose IME), so a focused `TextInput` is precisely the case
 * where keys legitimately arrive with something else focused — the exception
 * that made ZAB-70 refuse to look at the DOM focus in the first place.
 */
function focusYieldsKeys({ active, canvas, editor, body }: KeyFocus): boolean {
  if (active === null || active === undefined || active === body) return true;
  return active === canvas || (editor !== null && active === editor);
}

/**
 * Both ends are told, in this order: the pad is polled by ONE view, so the one
 * losing input has to stop its loop before the one taking it starts.
 */
function setOwner(next: InputView | null): void {
  const previous = current.owner;
  current.owner = next;
  previous?.syncPad();
  next?.syncPad();
}

export type { InputView, KeyFocus };
export { claimInput, focusYieldsKeys, ownsInput, registerView, unregisterView };
