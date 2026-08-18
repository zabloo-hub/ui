/**
 * The two pieces that decide what a person reads when an export fails (ZAB-80).
 *
 * `export.test.ts` covers them end to end, through the built CLI, because that is
 * the only place the real module resolution runs. What it cannot cover from there
 * is the cases that need a specific failure to arrive: a dependency that IS
 * installed but broken inside, an error that has nothing to do with resolution.
 * Those are the ones the narrowing exists for, so they are checked here against a
 * jiti that throws exactly what node would.
 */

import type { Jiti } from "jiti";
import { describe, expect, it } from "vitest";
import { importProjectDependency, sanitize } from "./config.js";

const ROOT = "/projects/game-ui";
const BASE = `${ROOT}/__zabloo_export__.mjs`;

/** The error node throws for a bare specifier it cannot resolve. */
function moduleNotFound(specifier: string): Error {
  const error = new Error(`Cannot find module '${specifier}'\nRequire stack:\n- ${BASE}`);
  (error as NodeJS.ErrnoException).code = "MODULE_NOT_FOUND";
  return error;
}

/** A jiti whose only job is to fail the way we want it to. */
function failingJiti(error: unknown): Jiti {
  return {
    import: () => Promise.reject(error),
  } as unknown as Jiti;
}

describe("importProjectDependency", () => {
  it("turns the dependency being absent into something the reader can act on", async () => {
    const jiti = failingJiti(moduleNotFound("react"));

    await expect(importProjectDependency(jiti, "react", ROOT)).rejects.toThrow(
      `react is not installed in ${ROOT} — a zabloo project runs its own views, so it needs ` +
        "react and @zabloo/react as dependencies. Run `pnpm install` there, or point --cwd at " +
        "a zabloo project.",
    );
  });

  // The reason the check is on the exact specifier and not just on the code: a
  // dependency that resolves and then cannot load is INSTALLED. Telling that
  // person to run `pnpm install` sends them round a loop they are already in,
  // and buries the name of what is actually missing.
  it("leaves a dependency that is installed but broken inside alone", async () => {
    const jiti = failingJiti(moduleNotFound("react-reconciler"));

    await expect(importProjectDependency(jiti, "@zabloo/react", ROOT)).rejects.toThrow(
      "Cannot find module 'react-reconciler'",
    );
  });

  it("leaves an error that is not about resolution alone", async () => {
    const jiti = failingJiti(new SyntaxError("Unexpected token"));

    await expect(importProjectDependency(jiti, "react", ROOT)).rejects.toThrow(
      new SyntaxError("Unexpected token"),
    );
  });
});

describe("sanitize", () => {
  it("drops the resolution base, and the stack header it was the only entry of", () => {
    expect(sanitize(`Cannot find module 'react'\nRequire stack:\n- ${BASE}`)).toBe(
      "Cannot find module 'react'",
    );
  });

  it("keeps a require stack that still names files the project has", () => {
    const message = `Cannot find module 'lodash'\nRequire stack:\n- ${ROOT}/src/views/main.tsx\n- ${BASE}`;

    expect(sanitize(message)).toBe(
      `Cannot find module 'lodash'\nRequire stack:\n- ${ROOT}/src/views/main.tsx`,
    );
  });

  it("does not touch a message that never mentioned it", () => {
    const message = "No views directory found at /projects/game-ui/src/views";

    expect(sanitize(message)).toBe(message);
  });
});
