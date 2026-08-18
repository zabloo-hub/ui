/**
 * Opening the preview in the browser (`--open`), which is the one thing `zabloo dev`
 * printed a URL for and left you to do by hand (ZAB-78).
 *
 * Failing to open a browser is never worth taking the dev loop down for: the URL is
 * on screen either way, and a headless box, an SSH session or a container simply has
 * no browser to hand the address to.
 */

import { spawn } from "node:child_process";

/** The platform's "open this with whatever handles it" command. */
export function openCommand(url: string, platform: NodeJS.Platform): [string, string[]] {
  if (platform === "darwin") return ["open", [url]];
  // `start` is a shell builtin, not an executable, so it needs cmd. The empty
  // string is the window TITLE: without it `start` reads a quoted URL as the
  // title and opens nothing.
  if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
  return ["xdg-open", [url]];
}

/** Hands `url` to the platform's browser. Detached, and never throws. */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const [command, args] = openCommand(url, platform);
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    // A browser outliving the CLI is the point; an ENOENT here is not an error
    // the person needs to act on, because the URL was printed a line earlier.
    child.on("error", () => {});
    child.unref();
  } catch {}
}
