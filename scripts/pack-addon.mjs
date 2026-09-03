// The Godot addon, packed as the zip a GitHub Release carries: `addons/zabloo/`
// with a binary for every platform the extension ships for, so unzipping it at
// the root of a Godot project is the whole installation.
//
// The addon is NOT an npm package and does not go through `changeset publish`,
// but it carries the version of the npm `fixed` group anyway (see
// docs/releasing.md): one number answers "which addon goes with the packages I
// installed", and the format the two halves agree on is the thing being
// versioned. `plugin.cfg` is stamped with it at pack time.
//
// What has to be in `bin/` is not a list kept here — it is read out of
// `zabloo.gdextension`, which is what Godot itself resolves against. A library
// named there and missing from the zip is a platform that silently has no addon,
// so it is an error rather than a smaller zip. Web is the one exception: it is
// experimental and its CI job never blocks, so it ships when it was built.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const ADDON_DIR = join("sdk", "godot", "addons", "zabloo");
/** The npm `fixed` group's version — any member carries it; the format is the anchor. */
const VERSION_FROM = join("packages", "format", "package.json");

/**
 * Every `res://addons/zabloo/bin/<file>` named in the `[libraries]` section, as
 * `{ platform, file }`. The platform comes from the KEY (`web.release.wasm32`),
 * not from the file name: the key is Godot's own vocabulary, while the name is
 * whatever suffix godot-cpp happened to stamp.
 */
function declaredLibraries(gdextension) {
  const entries = gdextension.matchAll(
    /^\s*([\w.]+)\s*=\s*"res:\/\/addons\/zabloo\/bin\/([^"]+)"/gm,
  );
  return [...entries].map(([, key, file]) => ({ platform: key.split(".")[0], file }));
}

/** Web is experimental (2026-08-24, Decision 4): built when it can be, never required. */
function isOptional(library) {
  return library.platform === "web";
}

/**
 * What the zip should contain, given the library file names the staging area
 * actually has. `missing` is what makes the pack fail; `extra` and `duplicate`
 * are reported so a stale or ambiguous artifact cannot ride along unnoticed.
 */
function planLibraries(gdextension, present) {
  const declared = declaredLibraries(gdextension);
  const have = new Set(present);
  const files = declared.map((library) => library.file);
  const named = (list) => list.map((library) => library.file);
  return {
    included: named(declared.filter((library) => have.has(library.file))),
    missing: named(declared.filter((library) => !have.has(library.file) && !isOptional(library))),
    skipped: named(declared.filter((library) => !have.has(library.file) && isOptional(library))),
    extra: [...new Set(present.filter((file) => !files.includes(file)))],
    // Two artifacts carrying the same file name are two builds of one library,
    // and only one of them would reach the zip — silently, and with no way to
    // tell which. Better to stop than to ship a coin flip.
    duplicate: [...new Set(present.filter((file, at) => present.indexOf(file) !== at))],
  };
}

/** `plugin.cfg` with its `version=` line set — the only line pack time rewrites. */
function stampVersion(pluginCfg, version) {
  if (!/^version\s*=/m.test(pluginCfg)) {
    throw new Error("plugin.cfg has no version= line to stamp");
  }
  return pluginCfg.replace(/^version\s*=.*$/m, `version="${version}"`);
}

function addonZipName(version) {
  return `zabloo-godot-addon-${version}.zip`;
}

function main() {
  const args = process.argv.slice(2);
  const allowPartial = args.includes("--allow-partial");
  const binDir = flagValue(args, "--bin") ?? join(ADDON_DIR, "bin");
  const outDir = flagValue(args, "--out") ?? "dist";

  const version = JSON.parse(readFileSync(VERSION_FROM, "utf8")).version;
  const gdextension = readFileSync(join(ADDON_DIR, "zabloo.gdextension"), "utf8");

  // Artifacts come down one directory per platform (`actions/download-artifact`
  // without a name), so the binaries are found rather than listed: what matters
  // is the file name, which is what the .gdextension resolves against.
  const present = filesUnder(binDir);
  const plan = planLibraries(
    gdextension,
    present.map((path) => basename(path)),
  );

  for (const library of plan.skipped) console.warn(`pack-addon: not built, skipped — ${library}`);
  for (const library of plan.extra)
    console.warn(`pack-addon: not in the .gdextension — ${library}`);
  if (plan.duplicate.length > 0) {
    console.error(
      `pack-addon: two builds of the same library under ${binDir}:\n  ${plan.duplicate.join("\n  ")}\n` +
        "Only one would reach the zip, and nothing would say which.",
    );
    process.exit(1);
  }
  if (plan.missing.length > 0) {
    const list = plan.missing.join("\n  ");
    if (!allowPartial) {
      console.error(
        `pack-addon: the .gdextension names libraries that were not built:\n  ${list}\n` +
          "Every platform in it must be in the zip, or that platform silently has no addon. " +
          "Pass --allow-partial for a local build you are only testing on this machine.",
      );
      process.exit(1);
    }
    console.warn(`pack-addon: --allow-partial, packing without:\n  ${list}`);
  }

  const staging = join(outDir, "addon");
  rmSync(staging, { recursive: true, force: true });
  const root = join(staging, "addons", "zabloo");
  mkdirSync(join(root, "bin"), { recursive: true });

  for (const entry of readdirSync(ADDON_DIR, { withFileTypes: true })) {
    if (entry.isFile()) cpSync(join(ADDON_DIR, entry.name), join(root, entry.name));
  }
  writeFileSync(
    join(root, "plugin.cfg"),
    stampVersion(readFileSync(join(ADDON_DIR, "plugin.cfg"), "utf8"), version),
  );
  const included = new Set(plan.included);
  for (const path of present) {
    if (included.has(basename(path))) cpSync(path, join(root, "bin", basename(path)));
  }

  const zip = addonZipName(version);
  rmSync(join(outDir, zip), { force: true });
  // `zip` rather than a writer of our own: the packing job runs on Linux, and a
  // store-only implementation here would be a second thing to keep correct.
  execFileSync("zip", ["-qr", join("..", zip), "addons"], { cwd: staging, stdio: "inherit" });
  console.log(`pack-addon: ${join(outDir, zip)} — ${plan.included.length} libraries, v${version}`);
}

/** `--flag value`, or null. */
function flagValue(args, flag) {
  const at = args.indexOf(flag);
  return at === -1 || at + 1 >= args.length ? null : args[at + 1];
}

/** `readdirSync`, with a missing directory reading as empty rather than throwing. */
function entriesOf(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Every file under `dir`, at any depth. */
function filesUnder(dir) {
  return entriesOf(dir).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

if (process.argv[1]?.endsWith("pack-addon.mjs")) main();

export { addonZipName, declaredLibraries, planLibraries, stampVersion };
