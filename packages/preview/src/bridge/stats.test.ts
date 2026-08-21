/**
 * `compact` is the one formatter the bridge still owns — the module note in
 * `stats.ts` says what happened to the rest.
 */

import { compact } from "@/bridge/stats";

describe("compact", () => {
  it("leaves small counts alone", () => {
    expect(compact(0)).toBe("0");
    expect(compact(999)).toBe("999");
  });

  it("shortens thousands to one decimal", () => {
    expect(compact(1000)).toBe("1.0k");
    expect(compact(43520)).toBe("43.5k");
  });
});
