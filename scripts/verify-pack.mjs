/**
 * verify-pack — the publish dry run (ZAB-58).
 *
 * `npm publish` is the one command with no undo: a broken tarball is a version
 * burned forever. So everything that publication would do is done here EXCEPT
 * the upload — `pnpm pack` every workspace package, read the tarballs, then
 * install them into a throwaway consumer OUTSIDE the workspace, where pnpm's
 * symlinks and the root node_modules cannot mask a missing file or an entry
 * point that only ever resolved because it was a sibling directory.
 *
 * What it asserts:
 *   - npm-facing metadata is complete (the ficha on npm links back to GitHub).
 *   - the tarball carries everything `main`/`types`/`bin`/`exports` point at,
 *     plus README and LICENSE, and nothing else.
 *   - `workspace:*` was rewritten to a real version by pack.
 *   - a clean consumer can import every entry point, typecheck against the
 *     shipped `.d.ts`, and run the bins.
 *   - `zabloo preview` really serves the preview chrome out of the tarball.
 *   - the end-to-end loop still works from tarballs alone: scaffold a project
 *     with `create-zabloo-app`, export it, and validate the envelope.
 *
 * Usage: `pnpm verify:pack` (after `pnpm build`), `--quick` to skip the
 * scaffold + export leg, `--keep` to leave the temp directory for inspection.
 */

import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const packagesDir = join(repo, "packages");

const REPO_URL = "https://github.com/zabloo-hub/ui";
const GIT_URL = `git+${REPO_URL}.git`;

/** npm puts these in every tarball regardless of `files`. */
const ALWAYS_PACKED = ["package/package.json", "package/README.md", "package/LICENSE"];

const quick = process.argv.includes("--quick");
const keep = process.argv.includes("--keep");

const failures = [];
/** Which package the checks below belong to — a slot, so `expect` can name it. */
const current = { package: "" };

function expect(ok, message) {
  if (ok) {
    console.log(`    ✓ ${message}`);
  } else {
    console.log(`    ✗ ${message}`);
    failures.push(`${current.package}: ${message}`);
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: "pipe", ...options });
}

/** Like `run`, but a non-zero exit is an answer rather than a throw. */
function tryRun(command, args, options = {}) {
  try {
    return { status: 0, stdout: run(command, args, options) };
  } catch (error) {
    return { status: error.status ?? 1, stdout: `${error.stdout || ""}${error.stderr || ""}` };
  }
}

// --- pack -----------------------------------------------------------------

const workspace = readdirSync(packagesDir)
  .map((dir) => ({ dir, path: join(packagesDir, dir) }))
  .filter(({ path }) => existsSync(join(path, "package.json")))
  .map((entry) => ({
    ...entry,
    pkg: JSON.parse(readFileSync(join(entry.path, "package.json"), "utf8")),
  }))
  // `private: true` means npm refuses to publish it, so there is no tarball to
  // dry-run (ZAB-82). `@zabloo/preview` is the first of them: the CLI copies its
  // build output into its own, and what verifies THAT is @zabloo/cli's tarball.
  // Same test `changeset-gate.mjs` applies, for the same reason.
  .filter(({ pkg }) => pkg.private !== true);

if (workspace.length === 0) {
  console.error("verify-pack: no packages found under packages/");
  process.exit(1);
}

const missingBuild = workspace.filter(({ path }) => !existsSync(join(path, "dist")));
if (missingBuild.length > 0) {
  console.error(
    `verify-pack: no dist/ in ${missingBuild.map((p) => p.pkg.name).join(", ")} — run \`pnpm build\` first`,
  );
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "zabloo-verify-pack-"));
const tarballs = join(tmp, "tarballs");
mkdirSync(tarballs);

console.log(`verify-pack: packing ${workspace.length} package(s) into ${tarballs}\n`);

for (const entry of workspace) {
  const { name, version } = entry.pkg;
  run("pnpm", ["pack", "--pack-destination", tarballs], { cwd: entry.path });
  // pnpm names the tarball the way npm does: scope folded into the filename.
  entry.tarball = join(tarballs, `${name.replace("@", "").replace("/", "-")}-${version}.tgz`);
  if (!existsSync(entry.tarball)) {
    console.error(`verify-pack: ${name} packed, but ${entry.tarball} is not there`);
    process.exit(1);
  }
  entry.entries = run("tar", ["-tzf", entry.tarball]).split("\n").filter(Boolean);
  entry.packed = JSON.parse(run("tar", ["-xzOf", entry.tarball, "package/package.json"]));
}

// --- metadata + tarball contents ------------------------------------------

for (const entry of workspace) {
  const { dir, pkg, packed, entries } = entry;
  current.package = pkg.name;
  console.log(`  ${pkg.name}@${pkg.version}  (${entries.length} files)`);

  // Metadata: what the npm page shows, and what links it back to the repo.
  expect(
    typeof packed.description === "string" && packed.description.length > 0,
    "has a description",
  );
  expect(packed.license === "MIT", "license is MIT");
  expect(Array.isArray(packed.keywords) && packed.keywords.length >= 3, "has keywords");
  expect(packed.homepage?.startsWith(REPO_URL) === true, "homepage points at the repo");
  expect(packed.bugs === `${REPO_URL}/issues`, "bugs points at the issue tracker");
  expect(packed.repository?.url === GIT_URL, "repository.url is the repo's git URL");
  expect(
    packed.repository?.directory === `packages/${dir}`,
    "repository.directory locates it in the monorepo",
  );
  expect(packed.publishConfig?.access === "public", "publishConfig.access is public");
  expect(typeof packed.engines?.node === "string", "declares engines.node");
  expect(packed.exports !== undefined, "declares exports (closed surface)");

  // A `workspace:` spec that survives packing is a package nobody can install.
  const specs = Object.entries({
    ...packed.dependencies,
    ...packed.peerDependencies,
    ...packed.optionalDependencies,
  });
  const unresolved = specs.filter(([, spec]) => String(spec).startsWith("workspace:"));
  expect(
    unresolved.length === 0,
    `no workspace: protocol left (${unresolved.map(([n]) => n).join(", ") || "none"})`,
  );

  // Contents: everything referenced, nothing extra.
  for (const file of ALWAYS_PACKED) {
    expect(entries.includes(file), `ships ${file.slice("package/".length)}`);
  }

  const roots = [...(packed.files ?? []), "package.json", "README.md", "LICENSE"];
  const strays = entries.filter((file) => {
    const path = file.slice("package/".length).replace(/\/$/, "");
    return path !== "" && !roots.some((root) => path === root || path.startsWith(`${root}/`));
  });
  expect(strays.length === 0, `nothing outside files: ${strays.join(", ") || "clean"}`);

  const targets = new Set();
  for (const value of [packed.main, packed.types, ...Object.values(packed.bin ?? {})]) {
    if (typeof value === "string") targets.add(value);
  }
  collectExportTargets(packed.exports, targets);
  for (const target of targets) {
    if (target === "./package.json") continue;
    expect(
      entries.includes(`package/${target.replace(/^\.\//, "")}`),
      `${target} is in the tarball`,
    );
  }

  if (packed.types) {
    expect(packed.types.endsWith(".d.ts"), "types points at a .d.ts");
  }

  for (const [command, target] of Object.entries(packed.bin ?? {})) {
    const source = run("tar", ["-xzOf", entry.tarball, `package/${target.replace(/^\.\//, "")}`]);
    expect(source.startsWith("#!"), `bin ${command} keeps its shebang`);
  }

  // The preview chrome is not a dependency — it is `@zabloo/preview`'s build
  // output, copied into `dist/preview/` by the CLI's build (ZAB-99). Nothing in
  // `exports` or `bin` points at it, so it is exactly the kind of file a `files`
  // change could drop without anything failing until someone opens the page.
  if (pkg.name === "@zabloo/cli") {
    expect(entries.includes("package/dist/preview/index.html"), "ships the preview chrome");
    const bundled = entries.filter((file) => file.startsWith("package/dist/preview/assets/"));
    expect(
      bundled.some((file) => file.endsWith(".js")) && bundled.some((file) => file.endsWith(".css")),
      `ships the preview's hashed assets (${bundled.length} file(s))`,
    );
    // Since ZAB-107 `/kit` arrives through `import()`, so it rides a chunk of its
    // own: a design-review page nobody who installs this will ever open has no
    // business in the bundle every preview parses. Nothing about the RUNNING page
    // would change if that regressed — `/kit` would keep working, back inside the
    // main chunk — which is why the shape of `dist/` is what gets asserted.
    const chunks = bundled.filter((file) => file.endsWith(".js"));
    expect(chunks.length > 1, `the kit rides a chunk of its own (${chunks.length} js file(s))`);
    // What index.html asks for has to BE there: the copy is recursive, but a
    // half-copied bundle would still serve a page — a blank one.
    const html = run("tar", ["-xzOf", entry.tarball, "package/dist/preview/index.html"]);
    const referenced = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(referenced.length > 0, "the preview's index.html references its bundle");
    expect(
      referenced.every((file) => entries.includes(`package/dist/preview/${file}`)),
      `every file index.html references is packed (${referenced.join(", ")})`,
    );
  }
}

function collectExportTargets(node, into) {
  if (typeof node === "string") into.add(node);
  else if (node && typeof node === "object")
    for (const value of Object.values(node)) collectExportTargets(value, into);
}

// --- a consumer outside the workspace -------------------------------------

current.package = "consumer";
console.log("\n  clean consumer (npm install of the tarballs)");

const consumer = join(tmp, "consumer");
mkdirSync(consumer);

/** Forces every transitive @zabloo/* dependency onto the tarball, not the registry. */
const overrides = Object.fromEntries(workspace.map((e) => [e.pkg.name, `file:${e.tarball}`]));

writeFileSync(
  join(consumer, "package.json"),
  `${JSON.stringify(
    {
      name: "zabloo-pack-consumer",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: { ...overrides, react: "^19.0.0" },
      devDependencies: { typescript: "^5.9.3", "@types/react": "^19.0.0" },
      overrides,
    },
    null,
    2,
  )}\n`,
);

try {
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: consumer });
  expect(true, "npm install of the 5 tarballs succeeds");
} catch (error) {
  expect(false, `npm install of the 5 tarballs succeeds — ${firstLine(error)}`);
  report();
}

// Runtime: the entry points a consumer actually reaches for.
writeFileSync(
  join(consumer, "probe.mjs"),
  `import { createRequire } from "node:module";
import { createElement } from "react";
import { IR_VERSION, parseEnvelope } from "@zabloo/format";
import { renderToIR, Text } from "@zabloo/react";
import { mount } from "@zabloo/renderer-web";

const envelope = parseEnvelope({
  v: IR_VERSION,
  tokens: { "color.primary": "#4f46e5" },
  views: { hud: { type: "Text", text: "hi", style: { color: "{color.primary}" } } },
});
const node = renderToIR(createElement(Text, null, "hi"));

// ./global is the IIFE bundle for plain <script> pages (see the renderer's
// README). It is loaded by path as often as by specifier, so keeping the
// condition free of import/require is what lets require.resolve see it too.
const globalBundle = createRequire(import.meta.url).resolve("@zabloo/renderer-web/global");

console.log(JSON.stringify({
  format: envelope.views.hud.type === "Text",
  react: node.type === "Text" && node.text === "hi",
  renderer: typeof mount === "function",
  globalBundle: globalBundle.endsWith("index.global.js"),
}));
`,
);

try {
  const probe = JSON.parse(run("node", ["probe.mjs"], { cwd: consumer }).trim());
  expect(probe.format, "@zabloo/format imports and validates an envelope");
  expect(probe.react, "@zabloo/react imports and renders JSX to IR");
  expect(probe.renderer, "@zabloo/renderer-web imports and exposes mount()");
  expect(probe.globalBundle, "@zabloo/renderer-web/global resolves from CJS require");
} catch (error) {
  expect(false, `the installed packages import cleanly — ${firstLine(error)}`);
}

// Types: the shipped .d.ts, resolved the way a modern consumer resolves them.
writeFileSync(
  join(consumer, "probe.ts"),
  `import type { Envelope, ZNode } from "@zabloo/format";
import { IR_VERSION } from "@zabloo/format";
import type { ZablooTheme } from "@zabloo/react";
import { renderToIR } from "@zabloo/react";
import type { MountOptions, ZablooHandle } from "@zabloo/renderer-web";
import { mount } from "@zabloo/renderer-web";

export const envelope: Envelope = { v: IR_VERSION, tokens: {}, views: {} };
export const node: (element: never) => ZNode = renderToIR;
export const theme: ZablooTheme = {};
export const open: (c: HTMLCanvasElement, e: string, o?: MountOptions) => ZablooHandle = mount;
`,
);
writeFileSync(
  join(consumer, "tsconfig.json"),
  `${JSON.stringify(
    {
      compilerOptions: {
        module: "nodenext",
        moduleResolution: "nodenext",
        target: "es2023",
        lib: ["es2023", "dom"],
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      files: ["probe.ts"],
    },
    null,
    2,
  )}\n`,
);

try {
  run(join(consumer, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], { cwd: consumer });
  expect(true, "the shipped .d.ts typecheck under moduleResolution: nodenext");
} catch (error) {
  expect(
    false,
    `the shipped .d.ts typecheck under moduleResolution: nodenext — ${firstLine(error)}`,
  );
}

// Bins: run as executables, so the shebang AND the exec bit are on trial.
const bin = (command) => join(consumer, "node_modules", ".bin", command);
const cliVersion = workspace.find((entry) => entry.dir === "cli").pkg.version;
const version = tryRun(bin("zabloo"), ["--version"]);
expect(version.stdout.trim() === cliVersion, `\`zabloo --version\` prints ${cliVersion}`);
expect(tryRun(bin("zb"), ["--help"]).stdout.includes("export"), "`zb --help` lists the commands");
// No target directory IS a usage error, so this one exits non-zero by design.
expect(
  tryRun(bin("create-zabloo-app"), ["--help"]).stdout.includes("Usage"),
  "`create-zabloo-app --help` prints usage",
);

// --- the preview, actually served -----------------------------------------

// Packing the chrome is half the promise; the other half is that the installed
// bin can find it and serve it (ZAB-99). Nothing here resolves `dist/preview`
// through node's module graph — it is located relative to `cli.js` — so a
// tarball that carries the files and a CLI that looks in the wrong place are
// indistinguishable until this runs.
current.package = "zabloo preview";
console.log("\n  the preview UI, served from the tarball");

await servePreview();

async function servePreview() {
  const envelope = join(repo, "golden", "envelopes", "controls.json");
  const server = spawn(bin("zabloo"), ["preview", envelope], {
    cwd: consumer,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  server.stdout.on("data", (chunk) => output.push(chunk.toString()));
  server.stderr.on("data", (chunk) => output.push(chunk.toString()));

  try {
    // The URL is READ from the banner rather than assumed: the server walks
    // forward when its port is taken, and a CI runner is exactly where something
    // else may already hold 5078.
    const url = await waitFor(() => /http:\/\/localhost:\d+\//.exec(output.join(""))?.[0]);
    if (url === undefined) {
      expect(
        false,
        `\`zabloo preview\` announces a URL — got: ${output.join("").trim() || "nothing"}`,
      );
      return;
    }

    const res = await waitFor(async () => {
      const answer = await fetch(url).catch(() => null);
      return answer?.ok === true ? answer : undefined;
    });
    if (res === undefined) {
      expect(false, `\`zabloo preview\` answers 200 on ${url}`);
      return;
    }
    expect(true, `\`zabloo preview\` answers 200 on ${url}`);

    const html = await res.text();
    expect(html.includes('<div id="root">'), "the page served is the new chrome");
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(script !== undefined, "the page references its hashed bundle");
    if (script !== undefined) {
      const asset = await fetch(new URL(script, url)).catch(() => null);
      expect(asset?.status === 200, `${script} is served (${asset?.status ?? "unreachable"})`);
    }
    // The kit is the second page of the same document (ZAB-98). It is checked
    // over the served tarball and not only in `preview-server.test.ts` for the
    // same reason `/` is: the route can be right and the files still be
    // somewhere the installed bin cannot reach.
    const kit = await fetch(new URL("/kit", url)).catch(() => null);
    expect(kit?.status === 200, "`zabloo preview` answers 200 on /kit");
    expect((await kit?.text()) === html, "/kit serves the same document as /");
    // The envelope is what the page is FOR, and the name is what the statusbar
    // prints — both from the same tarball, over the same server.
    const served = await fetch(new URL("/envelope", url)).catch(() => null);
    expect(served?.status === 200, "/envelope serves the golden envelope");
    expect(
      // Encoded on the wire since the handler hardening: a header is Latin-1 and
      // the name is user data. The chrome decodes it (`decodeEnvelopeName`).
      decodeURIComponent(served?.headers.get("x-zabloo-envelope-name") ?? "") === envelope,
      "/envelope names the file it was pointed at",
    );
  } finally {
    server.kill();
  }
}

/**
 * Polls `probe` until it returns something, or gives up. A poll and not a single
 * shot because the thing being waited for is a child process binding a socket,
 * and there is no event for "it is up" short of the banner it prints.
 */
async function waitFor(probe, attempts = 100, everyMs = 100) {
  for (const _ of Array.from({ length: attempts })) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((done) => setTimeout(done, everyMs));
  }
  return undefined;
}

// --- the whole loop, from tarballs only -----------------------------------

if (!quick) {
  current.package = "end-to-end";
  console.log("\n  end-to-end (scaffold → install → export)");

  const app = join(tmp, "my-game-ui");
  try {
    run(bin("create-zabloo-app"), [app], { cwd: consumer });
    expect(
      existsSync(join(app, "src", "views", "main-menu.tsx")),
      "create-zabloo-app scaffolds a project",
    );
    expect(existsSync(join(app, ".gitignore")), "the template's gitignore survives packing");
    expect(existsSync(join(app, "src", "assets", "logo.png")), "template assets survive packing");

    // What the scaffold WROTE, before we point it at the tarballs. This is the one
    // place the range is visible: `smoke-external` overwrites it with `file:` paths
    // and never sees it, which is how a hardcoded `^0.1.0` could have survived a
    // version bump and pinned every new user to a range nobody updated (ZAB-78).
    const appPkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
    const scaffolded = { ...appPkg.dependencies, ...appPkg.devDependencies };
    for (const dir of ["react", "cli"]) {
      const { name, version } = workspace.find((entry) => entry.dir === dir).pkg;
      expect(
        scaffolded[name] === `^${version}`,
        `create-zabloo-app scaffolds ${name}@^${version} (wrote ${scaffolded[name]})`,
      );
    }

    appPkg.overrides = overrides;
    for (const [name, spec] of Object.entries(overrides)) {
      if (appPkg.dependencies?.[name]) appPkg.dependencies[name] = spec;
      if (appPkg.devDependencies?.[name]) appPkg.devDependencies[name] = spec;
    }
    writeFileSync(join(app, "package.json"), `${JSON.stringify(appPkg, null, 2)}\n`);

    run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: app });
    const out = run(join(app, "node_modules", ".bin", "zabloo"), ["export", "--porcelain"], {
      cwd: app,
    }).trim();
    expect(existsSync(out), `zabloo export writes ${basename(dirname(out))}/${basename(out)}`);

    writeFileSync(
      join(consumer, "validate.mjs"),
      `import { readFileSync } from "node:fs";
import { readEnvelope } from "@zabloo/format";
const { envelope, diagnostics } = readEnvelope(readFileSync(process.argv[2], "utf8"));
console.log(JSON.stringify({ ok: envelope !== null, views: Object.keys(envelope?.views ?? {}), diagnostics }));
`,
    );
    const result = JSON.parse(run("node", ["validate.mjs", out], { cwd: consumer }).trim());
    expect(result.ok, "the exported envelope validates against the published @zabloo/format");
    expect(
      result.diagnostics.length === 0,
      `no diagnostics: ${JSON.stringify(result.diagnostics)}`,
    );
    expect(
      result.views.includes("main-menu"),
      `the envelope carries the scaffolded views (${result.views.join(", ")})`,
    );
  } catch (error) {
    expect(false, `the scaffolded project exports a valid envelope — ${firstLine(error)}`);
  }
}

report();

/** The line that says what actually broke, not the runtime's parting banner. */
function firstLine(error) {
  const lines = (`${error.stderr || ""}${error.stdout || ""}` || error.message)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    lines.find((line) => /error|not found|cannot/i.test(line)) ?? lines.at(-1) ?? String(error)
  );
}

function report() {
  if (!keep) rmSync(tmp, { recursive: true, force: true });
  else console.log(`\nverify-pack: kept ${tmp}`);

  if (failures.length > 0) {
    console.error(`\nverify-pack: ${failures.length} check(s) failed\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log("\nverify-pack: all checks passed — the tarballs are installable and usable.");
  process.exit(0);
}
