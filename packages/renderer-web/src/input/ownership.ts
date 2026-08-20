/**
 * Which mounted view owns the keyboard and the gamepad (ZAB-70).
 *
 * The pointer is scoped by construction — its listeners live on the canvas — but
 * the keys and the pad are not: `keydown` is a window event and
 * `navigator.getGamepads()` is a property of the page, so two views mounted side
 * by side would EACH move their own focus on every arrow and both consume the
 * same pad. That asymmetry was the bug.
 *
 * The rule is deliberately not "the view whose canvas has DOM focus": the hidden
 * `<textarea>` a focused `TextInput` types into lives OUTSIDE the canvas (it has
 * to — a canvas cannot compose IME), so keys legitimately arrive with something
 * else focused. What decides instead is the last view the player TOUCHED, with
 * the first one mounted owning input until anybody touches anything. A page with
 * a single view therefore behaves exactly as it always did.
 */

/** A view that can own input. The registry only ever asks it to re-check its pad. */
interface InputView {
  /** Start or stop this view's pad poll loop to match what it now owns. */
  syncPad(): void;
}

/** Mounted views, in mount order — the head is the default owner. */
const views: InputView[] = [];
let owner: InputView | null = null;

/** A view that has just mounted. The first one to arrive owns input. */
function registerView(view: InputView): void {
  views.push(view);
  if (owner === null) setOwner(view);
}

/** A view that has been disposed: ownership falls back to the oldest one left. */
function unregisterView(view: InputView): void {
  const index = views.indexOf(view);
  if (index >= 0) views.splice(index, 1);
  if (owner === view) setOwner(views[0] ?? null);
}

/**
 * The player touched this view — a pointer down on its canvas — so it takes the
 * keyboard and the pad. A view that is not mounted claims nothing.
 */
function claimInput(view: InputView): void {
  if (owner === view || !views.includes(view)) return;
  setOwner(view);
}

function ownsInput(view: InputView): boolean {
  return owner === view;
}

/**
 * Both ends are told, in this order: the pad is polled by ONE view, so the one
 * losing input has to stop its loop before the one taking it starts.
 */
function setOwner(next: InputView | null): void {
  const previous = owner;
  owner = next;
  previous?.syncPad();
  next?.syncPad();
}

export type { InputView };
export { claimInput, ownsInput, registerView, unregisterView };
