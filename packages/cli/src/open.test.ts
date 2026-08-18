/**
 * `--open` (ZAB-78). The interesting half is the argv, because it is what differs
 * per platform and what a Windows CI run would otherwise be the first to find out
 * about — and `start` is the one that bites: it is a `cmd` builtin and it reads a
 * lone quoted argument as a window title.
 */

import { describe, expect, it } from "vitest";
import { openBrowser, openCommand } from "./open.js";

describe("openCommand", () => {
  it("uses `open` on macOS", () => {
    expect(openCommand("http://localhost:5078/", "darwin")).toEqual([
      "open",
      ["http://localhost:5078/"],
    ]);
  });

  it("goes through cmd on Windows, with the empty title `start` needs", () => {
    const [command, args] = openCommand("http://localhost:5078/", "win32");
    expect(command).toBe("cmd");
    // The "" is the window title. Without it `start` treats the URL as the title
    // and opens nothing at all.
    expect(args).toEqual(["/c", "start", "", "http://localhost:5078/"]);
  });

  it("falls back to xdg-open everywhere else", () => {
    expect(openCommand("http://localhost:5078/", "linux")).toEqual([
      "xdg-open",
      ["http://localhost:5078/"],
    ]);
    expect(openCommand("http://localhost:5078/", "freebsd")[0]).toBe("xdg-open");
  });
});

describe("openBrowser", () => {
  it("does not throw when the platform has no browser to hand it to", () => {
    // The whole point: a headless box, a container or an SSH session must not
    // take the dev loop down over a command that is not installed. The URL was
    // printed a line earlier either way.
    expect(() => openBrowser("http://localhost:5078/", "linux")).not.toThrow();
  });
});
