/**
 * The stats badge (ported from `preview-client.test.ts`, ZAB-78). `stats()` has
 * been on the handle all along, reachable only by typing `zabloo.stats()` into
 * the console — which is precisely when you are not looking at the screen.
 */

import { formatStats, fpsWindow } from "@/bridge/stats";

const frame = {
  drawCalls: 17,
  vertices: 3400,
  indices: 5100,
  atlases: 1,
  atlasBytes: 4 * 1048576,
  resolved: 312,
  textLayouts: 0,
  bufferGrowths: 0,
  repaintOnly: false,
  ms: 2.125,
};

describe("formatStats", () => {
  it("says what the frame cost, in the renderer's own terms", () => {
    const text = formatStats(frame, 48);
    expect(text).toContain("48 fps");
    expect(text).toContain("2.13 ms");
    expect(text).toContain("17 draws");
    expect(text).toContain("3.4k verts");
    expect(text).toContain("1 atlas 4.0 MB");
    expect(text).toContain("312 resolved");
  });

  it("says `idle`, not `0 fps` — the renderer paints on demand", () => {
    // A still scene painting nothing is the system working. Reporting it as zero
    // frames per second reads as a stall.
    expect(formatStats(frame, 0)).toContain("idle");
    expect(formatStats(frame, 0)).not.toContain("0 fps");
  });

  it("marks a repaint-only frame as what it is", () => {
    expect(formatStats({ ...frame, repaintOnly: true }, 60)).toContain("repaint only");
  });

  it("has something to say before the first frame", () => {
    expect(formatStats(null, 0)).toBe("no frame painted yet");
  });
});

describe("fpsWindow", () => {
  it("counts the frames painted in the last second", () => {
    expect(fpsWindow([9000, 9500, 9990], 10000)).toEqual([9000, 9500, 9990]);
  });

  it("drops the ones that fell out of the window", () => {
    expect(fpsWindow([8000, 8999, 9000, 9500], 10000)).toEqual([9000, 9500]);
  });

  it("falls to zero on a scene that stopped painting", () => {
    // Re-derived against `now`, not only on arrival: a view that stopped drawing
    // would otherwise keep reporting the rate it had when it stopped.
    const painted = [9000, 9500];
    expect(fpsWindow(painted, 10000)).toHaveLength(2);
    expect(fpsWindow(painted, 12000)).toEqual([]);
  });

  it("leaves the timestamps it was given alone", () => {
    const painted = [8000, 9500];
    fpsWindow(painted, 10000);
    expect(painted).toEqual([8000, 9500]);
  });
});
