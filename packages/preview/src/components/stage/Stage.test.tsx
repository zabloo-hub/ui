/**
 * The stage, in the three things it is: what it SAYS it is showing (the
 * caption), how much of it fits (the scale, which is the whole of ZAB-78), and
 * whether what you are looking at is still the truth (the veil).
 *
 * The store is set directly rather than driven through the topbar: the stage is
 * a function of that state and of nothing else, which is why the scale can be
 * asserted at all without a browser to lay anything out.
 */

import { render } from "@testing-library/react";
import { DEFAULT_LAYOUT, EXPORT_FAILED, useStore } from "@/store";
import { Stage } from "./Stage";

const frame = () => document.querySelector('[data-slot="stage-frame"]');
const canvas = () => document.querySelector("canvas");
const veil = () => document.querySelector('[data-slot="stage-veil"]');
const caption = () => document.querySelector('[data-slot="stage-caption"]');
const box = () => document.querySelector('[data-slot="stage-box"]');
const area = () => document.querySelector('[data-slot="stage-area"]');
const pill = () => document.querySelector('[data-slot="stale-pill"]');

beforeEach(() => {
  useStore.setState({
    layout: { ...DEFAULT_LAYOUT, zen: false },
    viewport: { preset: "steamdeck" },
    custom: { width: 2800, height: 960 },
    dpr: 1,
    // 1280×800 into 1400×480 is the artboard's 60%.
    stageSize: { width: 1400, height: 480 },
    connection: "live",
    problems: [],
    runtime: { canvas: null },
  });
});

describe("Stage caption", () => {
  it("names the preset, the size, the dpr and the zoom", () => {
    render(<Stage />);

    expect(caption()).toHaveTextContent("Steam Deck · 1280×800 · @1× · 60%");
  });

  it("reports the stage itself under fit, with no zoom to speak of", () => {
    useStore.setState({ viewport: { preset: "fit" }, dpr: "auto" });

    render(<Stage />);

    expect(caption()).toHaveTextContent("Fit window · 1400×480 · @auto");
  });

  it("reports the custom size while custom is the preset", () => {
    useStore.setState({ viewport: { preset: "custom" }, dpr: 2 });

    render(<Stage />);

    expect(caption()).toHaveTextContent("Custom · 2800×960 · @2× · 50%");
  });

  it("goes away in zen, where the pill says it instead", () => {
    useStore.setState({ layout: { ...DEFAULT_LAYOUT, zen: true } });

    render(<Stage />);

    expect(caption()).toBeNull();
  });
});

describe("Stage scaling", () => {
  it("keeps the canvas at its logical size and scales the frame", () => {
    render(<Stage />);

    expect(canvas()).toHaveStyle({ width: "1280px", height: "800px" });
    expect(frame()).toHaveStyle({ width: "1280px", height: "800px" });
    expect(frame()).toHaveStyle({ transform: "scale(0.6)" });
  });

  it("reserves the box the frame VISUALLY takes, not the one it claims", () => {
    render(<Stage />);

    expect(box()).toHaveStyle({ width: "768px", height: "480px" });
  });

  it("never blows a small viewport up to fill a big stage", () => {
    useStore.setState({ stageSize: { width: 3000, height: 2000 } });

    render(<Stage />);

    expect(frame()).toHaveStyle({ transform: "scale(1)" });
    expect(caption()).toHaveTextContent("100%");
  });

  it("fills the stage with no transform at all under fit", () => {
    useStore.setState({ viewport: { preset: "fit" } });

    render(<Stage />);

    expect(canvas()).toHaveStyle({ width: "100%", height: "100%" });
    expect(frame()).not.toHaveStyle({ transform: "scale(1)" });
    expect(frame()).toHaveClass("h-full", "w-full");
    // Full bleed: nothing to round off, nothing to lift off the surround, and no
    // border to eat the two pixels the caption just promised the canvas has.
    expect(frame()).not.toHaveClass("border");
    expect(frame()).not.toHaveClass("rounded-md");
    expect(frame()).not.toHaveClass("shadow-frame");
  });

  // ZAB-101: `fitScale` fills whatever box it is handed, so with no inset the
  // frame's bottom edge landed on the console's border and its radius and shadow
  // were clipped against the chrome.
  it("insets the area under a preset, so the frame is not flush with the chrome", () => {
    render(<Stage />);

    expect(area()).toHaveClass("p-[14px]");
  });

  it("drops the inset under fit, where a light border is the opposite of the point", () => {
    useStore.setState({ viewport: { preset: "fit" } });

    render(<Stage />);

    expect(area()).not.toHaveClass("p-[14px]");
  });
});

describe("Stage canvas", () => {
  it("hands the canvas to the session and takes it back", () => {
    const { unmount } = render(<Stage />);

    expect(useStore.getState().runtime.canvas).toBe(canvas());

    unmount();

    expect(useStore.getState().runtime.canvas).toBeNull();
  });
});

describe("Stage stale veil", () => {
  it("leaves a live render alone", () => {
    render(<Stage />);

    expect(veil()).toBeNull();
    expect(pill()).toBeNull();
  });

  it("veils the last good render when the export failed", () => {
    useStore.setState({ connection: "stale" });

    render(<Stage />);

    expect(veil()).toBeInTheDocument();
    // What the pill SAYS is its own (`StalePill.test.tsx`); the stage decides
    // whether there is one at all.
    expect(pill()).toBeInTheDocument();
  });

  it("veils it for a fatal, whatever the connection says", () => {
    useStore.setState({
      problems: [{ severity: "fatal", code: EXPORT_FAILED, path: "", reason: "boom" }],
    });

    render(<Stage />);

    expect(veil()).toBeInTheDocument();
  });

  it("keeps the pill out of the scaled frame, so it stays legible", () => {
    useStore.setState({ connection: "stale" });

    render(<Stage />);

    expect(pill()?.parentElement).toBe(box());
    expect(frame()).not.toContainElement(pill() as HTMLElement);
  });
});
