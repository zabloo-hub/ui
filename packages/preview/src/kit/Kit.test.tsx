/**
 * The kit is verified by looking at it next to the artboard — that is the whole
 * point of the page, and no assertion in jsdom can stand in for it.
 *
 * So this is a smoke test with one job: catch a cell that stopped rendering. Each
 * case renders the whole page — both sheets, the mounted chrome included, which
 * costs seconds in jsdom — so assertions that answer the same question share one
 * render rather than paying for a second mount of everything to look at one more
 * attribute. The suite's own timeout is the package's (`vite.config.ts`).
 * Every cell is a specimen of something the chrome ships, and the way a kit page
 * rots is that one of them throws or quietly disappears and nobody notices,
 * because nobody re-opens the page until the next design review.
 *
 * One assertion here is NOT smoke, and is what buys the second sheet the right to
 * seed the store at all: the page must never write to the tool's storage. That one
 * is a contract, not a canary.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Kit } from "@/kit/Kit";

/** The ten cells of artboard 1e, by their handle and by the label above them. */
const CELLS: readonly [id: string, label: string][] = [
  ["view-selector", "View selector"],
  ["viewport-picker", "Viewport picker · open"],
  ["segmented-dpr", "Segmented · DPR"],
  ["console-tabs", "Console tabs"],
  ["binding-inputs", "Binding inputs"],
  ["badges", "Badges"],
  ["buttons", "Buttons"],
  ["tokens", "Tokens · light / dark"],
  ["log-lines", "Log line types"],
  ["bindings-toggle", "Bindings · toolbar toggle"],
];

/** The second sheet: one cell per chrome component, each mounting the real one. */
const CHROME: readonly [id: string, label: string][] = [
  ["topbar", "Topbar"],
  ["stage", "Stage"],
  ["console", "Console"],
  ["statusbar", "Statusbar"],
  ["binding-fields", "Binding fields · typed editors"],
  ["bindings-panel", "Bindings panel"],
  ["connection-pill", "Connection pill"],
  ["wordmark", "Wordmark"],
  ["gamepad", "Gamepad indicator"],
  ["stage-pills", "Stale pill"],
];

/**
 * A working `localStorage` that also remembers what was asked of it.
 *
 * Stubbed rather than borrowed, for the reason `store/storage.test.ts` gives: the
 * jsdom this suite runs in exposes an empty object under that name. Recording the
 * calls rather than diffing the contents is deliberate — the contract is that the
 * page writes NOTHING, and two identical blobs would let a write that happened to
 * put back the same bytes pass as no write at all.
 */
function recordingStorage(): Storage & { writes: string[] } {
  const map = new Map<string, string>();
  const writes: string[] = [];
  return {
    writes,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(key);
      map.set(key, value);
    },
    removeItem: (key: string) => {
      writes.push(key);
      map.delete(key);
    },
  } as unknown as Storage & { writes: string[] };
}

afterEach(() => {
  // `readTokenPairs` puts the class back as it found it, but a test that flipped
  // the toggle leaves the page in dark — and `<html>` outlives the render.
  document.documentElement.classList.remove("dark");
});

describe("Kit", () => {
  it("renders the ten cells of artboard 1e, and a swatch per token pair", () => {
    const { container } = render(<Kit />);

    for (const [id, label] of CELLS) {
      expect(container.querySelector(`[data-kit-cell="${id}"]`)).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
    expect(container.querySelectorAll("[data-token]")).toHaveLength(12);
  });

  it("starts in the theme <html> is already in, and toggles from there", async () => {
    render(<Kit />);

    expect(document.documentElement).not.toHaveClass("dark");

    await userEvent.click(screen.getByRole("button", { name: "Switch to dark" }));

    expect(document.documentElement).toHaveClass("dark");
  });

  it("mounts the real chrome in the second sheet", () => {
    const { container } = render(<Kit />);

    for (const [id, label] of CHROME) {
      expect(container.querySelector(`[data-kit-cell="${id}"]`)).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
    // Not the cells' own markup: the components INSIDE them, by the handles they
    // carry in the app. This is what tells a mounted specimen apart from one
    // reassembled out of primitives, which is the whole difference between the
    // two sheets.
    const slots = [
      "stage",
      "stage-veil",
      "stale-pill",
      "zen-pill",
      "statusbar",
      "connection-pill",
      "gamepad-indicator",
      "wordmark",
      "binding-field",
    ];
    for (const slot of slots) {
      expect(container.querySelector(`[data-slot="${slot}"]`)).toBeInTheDocument();
    }
    expect(container.querySelector('[data-panel="bindings"]')).toBeInTheDocument();

    // Frozen where the specimen would write, live where it only reads.
    const specimen = (id: string): Element | null =>
      container.querySelector(`[data-kit-cell="${id}"] [data-kit-specimen]`);
    expect(specimen("topbar")).toHaveAttribute("inert");
    expect(specimen("connection-pill")).not.toHaveAttribute("inert");
    expect(specimen("console")).not.toHaveAttribute("inert");
  });

  it("opens the console on a tab you can switch", async () => {
    const { container } = render(<Kit />);
    const cell = container.querySelector('[data-kit-cell="console"]') as HTMLElement;

    // The Actions log first, as the shell opens it — and the diagnostics one
    // click away, which is the only way the rows of ProblemsTab are on the page.
    expect(within(cell).getByRole("tab", { name: /Actions/ })).toHaveAttribute(
      "data-state",
      "active",
    );

    await userEvent.click(within(cell).getByRole("tab", { name: /Problems/ }));

    expect(container.querySelector('[data-slot="problems-tab"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="problem"]')).toHaveLength(3);
  });

  it("never writes to the tool's storage", async () => {
    const disk = recordingStorage();
    vi.stubGlobal("localStorage", disk);

    render(<Kit />);
    // Seeding is what would write, so the switcher is the worst case: three seeds
    // over everything the fixture touches, remembered fields included.
    await userEvent.click(screen.getByRole("radio", { name: "live" }));
    await userEvent.click(screen.getByRole("radio", { name: "disconnected" }));

    expect(disk.writes).toEqual([]);

    vi.unstubAllGlobals();
  });

  it("moves every store-driven specimen with one switch", async () => {
    const { container } = render(<Kit />);
    const pill = (): Element | null => container.querySelector('[data-slot="connection-pill"]');
    const statusbar = (): Element | null => container.querySelector('[data-slot="statusbar"]');

    expect(pill()).toHaveTextContent("Stale");
    expect(statusbar()).toHaveAttribute("data-connection", "stale");

    await userEvent.click(screen.getByRole("radio", { name: "live" }));

    expect(pill()).toHaveTextContent("Live");
    expect(statusbar()).toHaveAttribute("data-connection", "live");
  });
});
