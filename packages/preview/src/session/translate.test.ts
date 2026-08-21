/**
 * The words the two halves do not share. Small functions, but two of them decide
 * something: which view a diagnostic belongs to (the red dot in the picker hangs
 * off it) and how an action reads in the log.
 */

import type { Diagnostic } from "@zabloo/format";
import {
  actionLine,
  decodeEnvelopeName,
  dprOf,
  problemOf,
  viewLine,
  viewOf,
  writeLine,
} from "@/session";

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    level: "fatal",
    code: "invalid-node",
    path: 'views["hud"].children[2]',
    // Framed the way `@zabloo/format` really frames it (`validate.ts`, `push`):
    // a message that has to be legible alone on a terminal line, so it repeats
    // the path the diagnostic already carries in a field of its own.
    message: 'IR envelope: views["hud"].children[2] — node has no type, dropped',
    ...overrides,
  };
}

describe("the view a diagnostic is about", () => {
  it("reads the id out of the validator's path", () => {
    expect(viewOf('views["hud"].children[2].text')).toBe("hud");
  });

  it("keeps a dotted id whole — which is why the validator brackets keys", () => {
    expect(viewOf('views["shop.main"].children[0]')).toBe("shop.main");
  });

  it("has none for a diagnostic about the envelope itself", () => {
    expect(viewOf("")).toBeUndefined();
    expect(viewOf("tokens.color.brand")).toBeUndefined();
  });
});

describe("a diagnostic as the Problems tab holds it", () => {
  it("carries the level, the code, the path and the reason", () => {
    expect(problemOf(diagnostic({ level: "warn" }))).toEqual({
      severity: "warn",
      code: "invalid-node",
      path: 'views["hud"].children[2]',
      reason: "node has no type, dropped",
      view: "hud",
    });
  });

  it("names no view when the path names none", () => {
    expect(problemOf(diagnostic({ path: "" }))).not.toHaveProperty("view");
  });

  // ZAB-101: the row is `[code] path — reason`, so a reason that still carried
  // the message's own copy of the path printed it twice on every line.
  it("takes the path back out of the reason — the row prints it itself", () => {
    const problem = problemOf(diagnostic());

    expect(problem.reason).toBe("node has no type, dropped");
    expect(problem.reason).not.toContain(problem.path);
  });

  it("drops the prefix alone when the diagnostic is about the envelope", () => {
    const envelope = diagnostic({ path: "", message: "IR envelope: missing `views` map" });

    expect(problemOf(envelope).reason).toBe("missing `views` map");
  });

  it("passes a message it does not recognise through whole", () => {
    const foreign = diagnostic({ message: "something a later format wrote" });

    expect(problemOf(foreign).reason).toBe("something a later format wrote");
  });
});

describe("the log lines", () => {
  it("says where an action fired from when it came from a row (ZAB-29)", () => {
    expect(actionLine("buy", { path: "shop.items.3", index: 3 })).toBe("buy → shop.items.3 (#3)");
  });

  it("is just the action's name when it did not", () => {
    expect(actionLine("back")).toBe("back");
  });

  it("shows a written value the way the panel does", () => {
    expect(writeLine("player.gold", 1250)).toBe("player.gold = 1250");
    expect(writeLine("shop.items", [1, 2])).toBe("shop.items = [1,2]");
  });

  it("names the view that reached the canvas", () => {
    expect(viewLine("main")).toBe("loaded → main");
  });
});

describe("the DPR the renderer is handed", () => {
  it("is the browser's own when the picker says auto", () => {
    expect(dprOf("auto")).toBeUndefined();
  });

  it("is the forced ratio otherwise", () => {
    expect(dprOf(2)).toBe(2);
  });
});

describe("the envelope name off the wire", () => {
  it("decodes what the server encoded — the header is Latin-1, the path is not", () => {
    expect(decodeEnvelopeName(encodeURIComponent("ゲーム/build.json"))).toBe("ゲーム/build.json");
    expect(decodeEnvelopeName(encodeURIComponent("dist/zabloo.ir.json"))).toBe(
      "dist/zabloo.ir.json",
    );
  });

  it("reads a value that was never encoded as itself, instead of throwing", () => {
    // An older or hand-written server. `50%` alone is an invalid escape.
    expect(decodeEnvelopeName("plain-name.json")).toBe("plain-name.json");
    expect(decodeEnvelopeName("50% done.json")).toBe("50% done.json");
  });

  it("passes the absence through", () => {
    expect(decodeEnvelopeName(null)).toBeNull();
  });
});
