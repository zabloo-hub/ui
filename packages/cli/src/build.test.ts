import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { buildToFile } from "./build.js";

const here = dirname(fileURLToPath(import.meta.url));
const appPath = resolvePath(here, "../../../examples/button/app.tsx");

describe("buildToFile", () => {
  it("genera el documento IR esperado desde app.tsx", async () => {
    const outPath = await buildToFile(appPath);
    const written = JSON.parse(await readFile(outPath, "utf8"));
    expect(written.version).toBe("0.0.1-poc");
    expect(written.root.style.background).toBe("#4f46e5");
    expect(written.root.style.states.hover.background).toBe("#4338ca");
    expect(written.root.layout.paddingX).toBe(16);
    expect(written.root.children[0].text).toBe("Buy");
  });
});
