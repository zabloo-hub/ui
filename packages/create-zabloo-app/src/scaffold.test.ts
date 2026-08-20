/**
 * The scaffolder's contract. It is the first thing anyone runs into zabloo/ui
 * (`npx create-zabloo-app my-ui`), and a template that copies wrong is a broken
 * first impression, so the test scaffolds for real into a tmpdir and reads what
 * came out — no mocked filesystem, which would only assert that `cp` was called.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { isValidProjectName, ScaffoldError, scaffold } from "./scaffold.js";

/**
 * A tmpdir for one test, removed when it ends. Called from inside the test
 * rather than a `beforeEach` so the path can be a `const` the test owns — and
 * so the cleanup is registered next to the directory it cleans up.
 */
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zabloo-scaffold-"));
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

/** Reads the generated `package.json` — the file every assertion about versions goes through. */
async function readPkg(dir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
}

describe("project names", () => {
  it("accepts what npm accepts unscoped", () => {
    for (const name of ["my-ui", "ui", "a.b_c-1", "0"]) {
      expect(isValidProjectName(name), name).toBe(true);
    }
  });

  it("rejects uppercase, leading punctuation and spaces", () => {
    for (const name of ["MyUI", "-ui", ".ui", "_ui", "my ui", ""]) {
      expect(isValidProjectName(name), name).toBe(false);
    }
  });
});

describe("scaffold", () => {
  it("lays down the template, the dotfile and the generated package.json", async () => {
    const dir = join(await tempRoot(), "my-ui");

    const name = await scaffold(dir);

    expect(name).toBe("my-ui");
    const entries = (await readdir(dir)).sort();
    expect(entries).toEqual([
      ".gitignore",
      "README.md",
      "package.json",
      "src",
      "tsconfig.json",
      "zabloo.config.ts",
    ]);
    // Shipped without the dot (npm drops a `.gitignore` from the tarball), so
    // the rename is the scaffolder's job and nothing must be left behind.
    expect(entries).not.toContain("gitignore");
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toContain("node_modules/");
  });

  it("copies the starter views and the example component", async () => {
    const dir = join(await tempRoot(), "my-ui");

    await scaffold(dir);

    expect((await readdir(join(dir, "src", "views"))).sort()).toEqual([
      "main-menu.tsx",
      "settings.tsx",
    ]);
    expect(await readdir(join(dir, "src", "components"))).toContain("GoldRow.tsx");
    expect(await readdir(join(dir, "src", "assets"))).toContain("logo.png");
  });

  it("names the package after the directory and depends on the published range", async () => {
    const dir = join(await tempRoot(), "my-ui");

    await scaffold(dir);

    const pkg = await readPkg(dir);
    expect(pkg.name).toBe("my-ui");
    expect(pkg.private).toBe(true);
    expect(pkg.dependencies).toMatchObject({ "@zabloo/react": "^0.1.0" });
    expect(pkg.devDependencies).toMatchObject({ "@zabloo/cli": "^0.1.0" });
  });

  it("uses workspace:* under --workspace, so the monorepo can scaffold itself", async () => {
    const dir = join(await tempRoot(), "my-ui");

    await scaffold(dir, { workspace: true });

    const pkg = await readPkg(dir);
    expect(pkg.dependencies).toMatchObject({ "@zabloo/react": "workspace:*" });
    expect(pkg.devDependencies).toMatchObject({ "@zabloo/cli": "workspace:*" });
  });

  it("ships the dev loop as scripts of the generated project", async () => {
    const dir = join(await tempRoot(), "my-ui");

    await scaffold(dir);

    expect((await readPkg(dir)).scripts).toEqual({
      dev: "zabloo dev",
      "dev:unity": "zabloo dev --unity",
      build: "zabloo export",
      typecheck: "tsc --noEmit",
    });
  });

  it("substitutes the project name into the README", async () => {
    const dir = join(await tempRoot(), "my-ui");

    await scaffold(dir);

    const readme = await readFile(join(dir, "README.md"), "utf8");
    expect(readme).not.toContain("__PROJECT_NAME__");
    expect(readme).toContain("# my-ui");
  });

  it("refuses a name npm would reject, before touching the disk", async () => {
    const dir = join(await tempRoot(), "My-UI");

    await expect(scaffold(dir)).rejects.toBeInstanceOf(ScaffoldError);
    await expect(readdir(dir)).rejects.toThrow();
  });

  it("refuses a directory that already has something in it", async () => {
    const dir = join(await tempRoot(), "my-ui");
    await mkdir(dir);
    await writeFile(join(dir, "keep-me.txt"), "mine");

    await expect(scaffold(dir)).rejects.toBeInstanceOf(ScaffoldError);
    expect(await readdir(dir)).toEqual(["keep-me.txt"]);
  });

  it("scaffolds into an empty directory that already exists", async () => {
    const dir = join(await tempRoot(), "my-ui");
    await mkdir(dir);

    await expect(scaffold(dir)).resolves.toBe("my-ui");
  });
});
