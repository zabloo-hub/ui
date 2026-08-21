/**
 * The state the kit's chrome specimens are mounted against, and the seal that
 * makes seeding it safe.
 *
 * Ten of the twelve components the chrome is made of read the store and take no
 * props — `Statusbar` does not accept a connection, it reads one — so a kit that
 * refuses to touch the store is a kit that can only ever mirror the primitives
 * underneath them, which is what V17 shipped and what this ticket is about. The
 * page therefore seeds the store; what it must never do is CHANGE THE TOOL,
 * because `/kit` shares one `localStorage` with the real preview and half the
 * chrome writes to it (theme, viewport, dpr, the panel and console flags).
 *
 * So the rule is a mechanism and not a discipline: {@link sealStore} swaps the
 * persist middleware's storage for a sink before a single value is seeded, and
 * from then on nothing the page does can reach the disk. That is stronger than a
 * whitelist of fields the fixture is allowed to set — a whitelist would go quietly
 * out of date the day someone adds a field to `partialize` — and it is what lets
 * the stage specimen pin a preset (`fit`, the default on a fresh profile, is the
 * one preset with no frame, no border and no zoom to show).
 *
 * ONE HOLE, and it is why some specimens are inert: `views.selectView` writes the
 * remembered view straight through `storage`, outside `persist`, so the seal does
 * not cover it. Anything that can reach it — the topbar's view selector, a
 * Problems row that names another view — is mounted inert or seeded so the button
 * never appears.
 *
 * The three scenarios are the three the chrome is drawn for. They exist because
 * there is exactly one store on the page: two `ConnectionPill`s cannot show two
 * states side by side, so the kit shows one at a time and lets you flip.
 */

import type { Binding, BindingType, Problem } from "@/store";
import { useStore } from "@/store";

/** Which of the three the chrome is currently showing. */
type Scenario = "live" | "stale" | "disconnected";

const SCENARIOS: readonly Scenario[] = ["live", "stale", "disconnected"];

/** The stderr of a save that never became an envelope, as V13 reports it. */
const EXPORT_ERROR =
  "src/views/controls.tsx:42:8 - error TS2322: Type 'string' is not assignable to type 'number'.";

/**
 * The problems each scenario carries.
 *
 * NONE of them names a `view`, and that is load-bearing: `ProblemsTab` turns a
 * row into a button when it can take you somewhere else, and pressing that button
 * calls `selectView` — the one write the seal does not stop. Without a target the
 * rows are the static ones, which is what the artboard draws anyway.
 */
const PROBLEMS: Record<Scenario, readonly Problem[]> = {
  live: [
    {
      severity: "warn",
      code: "invalid-node",
      path: 'views["controls"].children[2].text',
      reason: "missing",
    },
    {
      severity: "warn",
      code: "unknown-token",
      path: 'views["controls"].children[5].style.background',
      reason: "{color.accnt} does not resolve",
    },
  ],
  stale: [
    {
      severity: "warn",
      code: "invalid-node",
      path: 'views["controls"].children[2].text',
      reason: "missing",
    },
    { severity: "fatal", code: "export-failed", path: "", reason: EXPORT_ERROR },
    {
      severity: "warn",
      code: "unknown-token",
      path: 'views["controls"].children[5].style.background',
      reason: "{color.accnt} does not resolve",
    },
  ],
  disconnected: [],
};

/** The lines of artboard 1a's log, at fixed times so the page never moves. */
const ACTIONS = [
  { ts: at("12:04:27"), kind: "view" as const, text: "loaded → controls" },
  { ts: at("12:04:29"), kind: "write" as const, text: "settings.sfx = true" },
  { ts: at("12:04:31"), kind: "action" as const, text: "buy → shop.items.3 (#3)" },
];

/** Today at `hh:mm:ss` — `ActionsTab` prints the local wall clock off the stamp. */
function at(time: string): number {
  const [h = 0, m = 0, s = 0] = time.split(":").map(Number);
  const day = new Date();
  day.setHours(h, m, s, 0);
  return day.getTime();
}

/**
 * The demo paths of artboard 1a, minus `settings.sfx`.
 *
 * These are seeded into the store because the typed editors are meant to be
 * TYPED IN, and a field only shows what you typed if the value comes back to it
 * — `BindingField` writes through `setFromEditor` and re-reads its binding from
 * the prop, so a kit holding its own copy would render a box you cannot edit.
 * Being the store's, they are also disposable: flipping the scenario reseeds
 * them, which is the page's undo.
 *
 * `settings.sfx` is the one path that stays OUT of here, because it is the one
 * whose state has a clock on it. See `BindingFieldsCell`.
 */
const BINDINGS: readonly [path: string, type: BindingType, value: unknown][] = [
  ["player.gold", "number", 1250],
  ["player.name", "string", "Aria"],
  ["settings.music", "boolean", false],
  ["settings.volume", "number", 80],
  [
    "shop.items",
    "array",
    [
      { id: "potion", price: 25 },
      { id: "elixir", price: 60 },
      { id: "shield", price: 140 },
      { id: "sword", price: 320 },
    ],
  ],
];

function bindings(): { byPath: Record<string, Binding>; order: string[] } {
  const byPath: Record<string, Binding> = {};
  for (const [path, type, value] of BINDINGS) {
    byPath[path] = { path, type, value, lastWriteFrom: null, writtenAt: null };
  }
  return { byPath, order: BINDINGS.map(([path]) => path) };
}

/** A frame that painted, so the Stats tab has something other than its empty state. */
const FRAME = {
  frameMs: 1.9,
  drawCalls: 42,
  vertices: 18_240,
  atlases: 3,
  atlasBytes: 12 * 1024 * 1024,
  resolved: 58,
  repaintOnly: false,
  textLayouts: 0,
  bufferGrowths: 0,
};

/**
 * Cut the store off from the disk. Idempotent, and called before the first seed.
 *
 * `persist.setOptions` is zustand's own API for this, so the middleware keeps
 * working — it just writes into nothing. Hydration has already happened by the
 * time this runs (the store is created at import), which is why the kit starts
 * from your real theme and viewport and only then overrides them.
 */
function sealStore(): void {
  useStore.persist.setOptions({
    storage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  });
}

/**
 * Everything the chrome specimens read, for one scenario.
 *
 * Written with `setState` rather than through the slices' own actions on purpose:
 * an action is the tool doing something (`selectView` remembers, `setIdentity`
 * re-resolves the active view), and the kit is not the tool. This is a value
 * being put on a page.
 */
function seedFixture(scenario: Scenario): void {
  useStore.setState({
    // The stage's geometry is the point of its cell, and `fit` — the default on
    // a fresh profile — is the one preset that has none: no frame, no border, no
    // zoom in the caption.
    viewport: { preset: "steamdeck" },
    dpr: 1,
    envelope: { name: "controls.zabloo.ir.json" },
    views: ["layout", "typography", "controls", "overlays"],
    activeView: "controls",
    fatalViews: scenario === "stale" ? new Set(["overlays"]) : new Set(),
    connection: scenario === "live" ? "live" : scenario === "stale" ? "stale" : "disconnected",
    // The pill only grows its tooltip once there is a message to put in it.
    lastError: scenario === "stale" ? EXPORT_ERROR : null,
    problems: [...PROBLEMS[scenario]],
    actions: [...ACTIONS],
    bindings: bindings(),
    stats: { last: FRAME, fps: 60 },
    // The two drawers open and the panel back at the corner it opens in — the
    // remembered values are the tool's, and a specimen that landed wherever it
    // was last dragged would not be a specimen of anything.
    layout: {
      ...useStore.getState().layout,
      panelOpen: true,
      panelPos: null,
      consoleOpen: true,
      zen: false,
    },
  });
}

export { SCENARIOS, type Scenario, sealStore, seedFixture };
