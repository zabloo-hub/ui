/**
 * The scenes the performance work is measured against (ZAB-73) — the ones the
 * golden corpus deliberately is not.
 *
 * The corpus documents BEHAVIOR, so its cases are as small as the rule they
 * record: `repeat.json` is 1,5 KB and every scene fits in 480×320. That makes it
 * a bad budget: draw calls and vertices sat at a third of their ceiling, and a
 * regression in the frame of a real screen — a thousand-row list, a wall of
 * wrapped prose, a panel mid-transition — had nothing in CI to trip over.
 *
 * These scenes are WEB-LOCAL on purpose, and not corpus cases: their metrics are
 * `stats()`, which is web-only telemetry (deliberately outside `snapshot()`, the
 * cross-target contract), and a thousand rows of recorded rects would be a
 * megabyte of golden nobody reads. `budgets.test.ts` asserts them in CI and
 * `bench.test.ts` times the same scenes by hand — one definition, so the number
 * CI holds and the number a before/after compares are about the same frame.
 *
 * Viewport: 960×600, a screen and not a thumbnail. It is the second reason the
 * numbers here are worth holding — the corpus measures what fits in a postcard.
 */

/** A scene to measure: everything `mountGolden` needs, plus what it is for. */
export interface PerfScene {
  /** What this scene puts under load — the first thing a reader of a diff needs. */
  about: string;
  envelope: object;
  /** Seeded through `setData` before the first measured frame. */
  data?: Record<string, unknown>;
  width: number;
  height: number;
}

/** A screen, not a postcard: the size the budgets below are stated at. */
export const PERF_SIZE = { width: 960, height: 600 };

const BG = "#101218";
const PANEL = "#1e293b";
const ROW = "#334155";
const INK = "#e2e8f0";
const HOT = "#f97316";

/** Duration every transition in `motion` runs at — the tests step to its middle. */
export const MOTION_MS = 400;

// --- 1.000 unequal rows, virtualized ---

/**
 * Deterministic label lengths → rows wrapping to 1..4 lines in their column, so
 * the list exercises the unequal-extent path (the one virtualization's "biggest
 * instance wins" rule is about) instead of a thousand identical boxes.
 */
export function unequalItems(count: number): Array<{ id: string; label: string; note: string }> {
  return Array.from({ length: count }, (_, i) => ({
    id: `it-${i}`,
    label: `Item ${i} — ${"palabra ".repeat(1 + ((i * 7) % 9))}`,
    note: `#${i}`,
  }));
}

const LIST_ENVELOPE = {
  v: 1,
  views: {
    main: {
      type: "Container",
      id: "root",
      layout: { direction: "column", padding: 12, gap: 8 },
      style: { background: BG },
      children: [
        {
          type: "Text",
          id: "title",
          text: "Inventario",
          style: { color: INK, fontSize: 20 },
        },
        {
          type: "ScrollView",
          id: "scroller",
          axis: "vertical",
          layout: { direction: "column", width: 640, height: 520, padding: 8, gap: 6 },
          style: { background: PANEL, radius: 6 },
          children: [
            {
              type: "Repeat",
              id: "rows",
              items: { bind: "list.items" },
              as: "item",
              key: "id",
              layout: { direction: "column", gap: 6 },
              children: [
                {
                  type: "Container",
                  id: "row",
                  layout: { direction: "row", width: 608, padding: 8, gap: 8 },
                  style: { background: ROW, radius: 4 },
                  children: [
                    {
                      type: "Text",
                      id: "row-label",
                      layout: { grow: 1 },
                      text: { bind: "item.label" },
                      style: { color: INK },
                    },
                    {
                      type: "Text",
                      id: "row-note",
                      text: { bind: "item.note" },
                      style: { color: "#94a3b8", fontSize: 12 },
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

// --- a wall of wrapped prose ---

const PARAGRAPH =
  "El zorro marrón salta sobre el perro perezoso una y otra vez, mientras la " +
  "tipografía se rompe en líneas que el motor tiene que medir cada vez que algo " +
  "de su entrada se mueve. Un párrafo largo es el caso que más trabajo de texto " +
  "mete en un frame, y por eso está aquí.";

/** Three columns × four paragraphs, at three point sizes (three live atlases). */
const TEXT_ENVELOPE = {
  v: 1,
  views: {
    main: {
      type: "Container",
      id: "root",
      layout: { direction: "row", padding: 12, gap: 12 },
      style: { background: BG },
      children: [14, 16, 20].map((fontSize, column) => ({
        type: "Container",
        id: `column-${column}`,
        layout: { direction: "column", width: 300, gap: 10, padding: 8 },
        style: { background: PANEL, radius: 6 },
        children: [
          {
            type: "Text",
            id: `heading-${column}`,
            text: `Columna ${column}`,
            style: { color: HOT, fontSize },
          },
          ...Array.from({ length: 4 }, (_, i) => ({
            type: "Text",
            id: `para-${column}-${i}`,
            text: PARAGRAPH,
            layout: { width: 284 },
            style: {
              color: INK,
              fontSize,
              // The last one is capped and ellipsized: the wrap path that has to
              // find a break AND measure the ellipsis against it.
              ...(i === 3 ? { maxLines: 3, overflow: "ellipsis" } : {}),
            },
          })),
        ],
      })),
    },
  },
};

// --- a panel with motion in flight ---

/**
 * Twelve rows whose Toggle, ProgressBar and Collapse all move at once: the
 * frame a transition-heavy screen actually costs, which the corpus only ever
 * records at REST (`transitions.json` runs the clock to the end on purpose).
 */
const MOTION_ENVELOPE = {
  v: 1,
  views: {
    main: {
      type: "Container",
      id: "root",
      layout: { direction: "column", padding: 12, gap: 8 },
      style: { background: BG },
      children: [
        {
          type: "Collapse",
          id: "section",
          open: false,
          transition: { duration: MOTION_MS, easing: "ease-out" },
          layout: { direction: "column", width: 900, padding: 8, gap: 8 },
          style: { background: PANEL, radius: 6 },
          children: [
            {
              type: "Container",
              id: "section-header",
              layout: { direction: "row", height: 32, align: "center", padding: 6 },
              style: { background: ROW, radius: 4 },
              children: [
                { type: "Text", id: "section-title", text: "Ajustes", style: { color: INK } },
              ],
            },
            ...Array.from({ length: 12 }, (_, i) => ({
              type: "Container",
              id: `row-${i}`,
              layout: { direction: "row", width: 868, height: 36, align: "center", gap: 12 },
              style: { background: ROW, radius: 4 },
              transition: { duration: MOTION_MS, easing: "ease-out" },
              children: [
                {
                  type: "Text",
                  id: `row-label-${i}`,
                  layout: { grow: 1 },
                  text: `Opción ${i}`,
                  style: { color: INK },
                },
                {
                  type: "ProgressBar",
                  id: `bar-${i}`,
                  value: { bind: "job.progress" },
                  transition: { duration: MOTION_MS, easing: "linear" },
                  layout: { width: 160, height: 8 },
                  style: { background: "#0f172a", radius: 4 },
                  children: [
                    { type: "Container", id: `fill-${i}`, style: { background: HOT, radius: 4 } },
                  ],
                },
                {
                  type: "Toggle",
                  id: `toggle-${i}`,
                  checked: { bind: "ui.armed" },
                  transition: { duration: MOTION_MS, easing: "ease-out" },
                  layout: { width: 44, height: 24, padding: 2 },
                  style: { background: "#0f172a", radius: 12 },
                  states: { checked: { style: { background: HOT } } },
                  children: [
                    { type: "Container", id: `on-${i}`, layout: { width: 20, height: 20 } },
                    { type: "Container", id: `off-${i}`, layout: { width: 20, height: 20 } },
                  ],
                },
              ],
            })),
          ],
        },
      ],
    },
  },
};

// --- a dense screen, with and without a loop running ---

/**
 * A populated screen — 24 rows of chrome and text, a footer with a field — in
 * the two shapes the steady-frame budgets need:
 *
 * - with a Spinner, it is a scene where SOMETHING is always animating, so every
 *   frame runs the whole pipeline. That is what pins "a steady animation frame
 *   allocates no geometry and re-wraps no text" (ZAB-55's buffer reuse, ZAB-69's
 *   wrap cache) to a number CI can hold.
 * - without one, the focused field is the only thing on the clock, which is the
 *   caret frame ZAB-73 made cheap — `repaintOnly`, and nothing resolved.
 */
function denseEnvelope(spinner: boolean): object {
  return {
    v: 1,
    views: {
      main: {
        type: "Container",
        id: "root",
        layout: { direction: "column", padding: 12, gap: 6 },
        style: { background: BG },
        children: [
          ...Array.from({ length: 24 }, (_, i) => ({
            type: "Container",
            id: `line-${i}`,
            layout: {
              direction: "row",
              width: 900,
              height: 18,
              align: "center",
              padding: 4,
              gap: 8,
            },
            style: { background: i % 2 === 0 ? PANEL : ROW, radius: 4 },
            children: [
              {
                type: "Text",
                id: `who-${i}`,
                text: `jugador-${i % 7}`,
                style: { color: HOT, fontSize: 12 },
              },
              {
                type: "Text",
                id: `what-${i}`,
                layout: { grow: 1 },
                text: `ha entrado en la sala ${i} y saluda a todo el mundo`,
                style: { color: INK, fontSize: 12 },
              },
            ],
          })),
          {
            type: "Container",
            id: "composer",
            layout: {
              direction: "row",
              width: 900,
              height: 40,
              align: "center",
              gap: 8,
              padding: 4,
            },
            style: { background: PANEL, radius: 6 },
            children: [
              {
                type: "TextInput",
                id: "message",
                value: { bind: "chat.draft" },
                placeholder: "Escribe algo…",
                layout: { grow: 1, height: 28, padding: 6 },
                style: { background: "#0f172a", color: INK, radius: 4 },
                states: { focused: { style: { borderWidth: 2, borderColor: HOT } } },
              },
              ...(spinner
                ? [
                    {
                      type: "Spinner",
                      id: "spin",
                      period: 900,
                      layout: { direction: "row", gap: 6, align: "center", height: 12 },
                      children: [0, 1, 2].map((i) => ({
                        type: "Container",
                        id: `bead-${i}`,
                        layout: { width: 8, height: 8 },
                        style: { background: INK, radius: 4 },
                      })),
                    },
                  ]
                : []),
            ],
          },
        ],
      },
    },
  };
}

/**
 * The scenes, by name. `budgets.test.ts` walks them for the geometry budgets and
 * then drives the ones with motion in them; `bench.test.ts` times the same set.
 */
export const PERF_SCENES: Record<string, PerfScene> = {
  list: {
    about:
      "1.000 unequal rows virtualized inside a scroller — the biggest list a real screen shows.",
    envelope: LIST_ENVELOPE,
    data: { "list.items": unequalItems(1000) },
    ...PERF_SIZE,
  },
  text: {
    about:
      "Three columns of wrapped prose at three point sizes, one of them capped and ellipsized.",
    envelope: TEXT_ENVELOPE,
    ...PERF_SIZE,
  },
  motion: {
    about:
      "Twelve rows of toggles, bars and a Collapse, measured MID-transition instead of at rest.",
    envelope: MOTION_ENVELOPE,
    data: { "ui.armed": false, "job.progress": 0 },
    ...PERF_SIZE,
  },
  "dense-loop": {
    about: "A populated screen with a Spinner running — the steady animation frame.",
    envelope: denseEnvelope(true),
    data: { "chat.draft": "" },
    ...PERF_SIZE,
  },
  "dense-caret": {
    about: "The same screen with nothing looping, so a focused field's caret owns the clock alone.",
    envelope: denseEnvelope(false),
    data: { "chat.draft": "" },
    ...PERF_SIZE,
  },
};
