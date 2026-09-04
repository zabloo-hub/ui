// The Unity SDK, packed as the `.tgz` a GitHub Release carries: `com.zabloo.sdk`
// with a native core for every platform the package ships for, so that
// `"com.zabloo.sdk": "file:com.zabloo.sdk-<version>.tgz"` in a project's
// `Packages/manifest.json` is the whole installation.
//
// It is NOT an npm package and does not go through `changeset publish`, but it
// carries the version of the npm `fixed` group anyway (see docs/releasing.md):
// one number answers "which SDK goes with the packages I installed", and the
// format the two halves agree on is the thing being versioned. `package.json`
// is stamped with it at pack time.
//
// What has to be in `Runtime/Plugins/` is not a list kept here — it is read
// out of `sdk/unity/SConstruct`, the `PLATFORMS` table `scons install` writes
// each binary's `.meta` from. A slot named there and missing from the tarball
// is a platform that silently has no SDK, so it is an error rather than a
// smaller tarball. A binary and its `.meta` are ONE thing: without the `.meta`
// Unity imports the file with default settings and enables it for every
// platform, which is a different wrong install.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, relative, sep } from "node:path";

const PACKAGE_DIR = join("sdk", "unity");
const PLUGINS_DIR = join("Runtime", "Plugins");
/** The npm `fixed` group's version — any member carries it; the format is the anchor. */
const VERSION_FROM = join("packages", "format", "package.json");

/**
 * Every plugin slot the `PLATFORMS` table of `sdk/unity/SConstruct` names, as
 * `{ platform, slot }` with the slot as a POSIX path under `Runtime/Plugins/`
 * (`Windows/x86_64/zabloo.dll`). The table is Python, so this reads the one
 * shape it has — `"<platform>": ([…], os.path.join("a", "b"))` — rather than
 * evaluating it; a change to that shape fails here, loudly, not in a tarball.
 */
function declaredSlots(sconstruct) {
  const table = sconstruct.match(/^PLATFORMS\s*=\s*\{([\s\S]*?)^\}/m);
  if (!table) throw new Error("sdk/unity/SConstruct has no PLATFORMS table to read");
  const entries = table[1].matchAll(
    /^\s*"(\w+)"\s*:\s*\(\s*\[[^\]]*\]\s*,\s*os\.path\.join\(([^)]*)\)\s*\)/gm,
  );
  return [...entries].map(([, platform, args]) => ({
    platform,
    slot: [...args.matchAll(/"([^"]+)"/g)].map(([, part]) => part).join("/"),
  }));
}

/** `path/to/x.dll.meta` → `path/to/x.dll`, or null for anything that is not a `.meta`. */
function assetOf(path) {
  return path.endsWith(".meta") ? path.slice(0, -".meta".length) : null;
}

/**
 * What the tarball should contain, given the file paths (POSIX, any prefix)
 * the staging area actually has. A file belongs to a slot when its path ends
 * with the slot — `Linux/x86_64/libzabloo.so` and `Android/arm64-v8a/libzabloo.so`
 * share a file name, so the name alone cannot say which is which. `missing` is
 * what makes the pack fail; `extra` and `duplicate` are reported so a stale or
 * misplaced artifact cannot ride along unnoticed.
 */
function planPlugins(declared, present) {
  const endsWithSlot = (path, slot) => path === slot || path.endsWith(`/${slot}`);
  const found = declared.map(({ slot }) => ({
    slot,
    binaries: present.filter((path) => endsWithSlot(path, slot)),
    metas: present.filter((path) => endsWithSlot(path, `${slot}.meta`)),
  }));
  const claimed = new Set(found.flatMap(({ binaries, metas }) => [...binaries, ...metas]));
  const names = new Set(declared.map(({ slot }) => posix.basename(slot)));
  return {
    included: found
      .filter(({ binaries, metas }) => binaries.length === 1 && metas.length === 1)
      .map(({ slot, binaries, metas }) => ({ slot, binary: binaries[0], meta: metas[0] })),
    // Half a slot is missing too: a binary without its .meta is imported with
    // Unity's defaults and enabled everywhere, which is not this platform's SDK.
    missing: found
      .filter(({ binaries, metas }) => binaries.length === 0 || metas.length === 0)
      .map(({ slot, binaries, metas }) =>
        binaries.length === 0 && metas.length === 0
          ? slot
          : binaries.length === 0
            ? `${slot} (only its .meta was built)`
            : `${slot}.meta (the binary is there, its import settings are not)`,
      ),
    // A file NAMED like a plugin that sits in no slot: a build that landed in
    // the wrong directory would otherwise be reported as that platform missing.
    extra: present.filter((path) => {
      const name = posix.basename(assetOf(path) ?? path);
      return names.has(name) && !claimed.has(path);
    }),
    // Two artifacts carrying the same slot are two builds of one library, and
    // only one of them would reach the tarball — silently, and with no way to
    // tell which. Better to stop than to ship a coin flip.
    duplicate: found
      .filter(({ binaries, metas }) => binaries.length > 1 || metas.length > 1)
      .map(({ slot }) => slot),
  };
}

/** `package.json` with its `version` set — the only field pack time rewrites. */
function stampVersion(packageJson, version) {
  const manifest = JSON.parse(packageJson);
  if (manifest.name !== "com.zabloo.sdk") {
    throw new Error(`refusing to stamp ${manifest.name}: not the Unity SDK's package.json`);
  }
  return `${JSON.stringify({ ...manifest, version }, null, 2)}\n`;
}

/** What `npm pack` names it: `<name>-<version>.tgz`. */
function tarballName(version) {
  return `com.zabloo.sdk-${version}.tgz`;
}

/**
 * Whether a file of the checked-out package goes into the tarball. Out: the
 * installer and its .meta (a game never runs `scons`), dotfiles (`.gitkeep`
 * holds the empty slot directories in git; Unity ignores dotfiles anyway), and
 * whatever a local `scons install` left in a slot — the plugins come from the
 * plan, never from the checkout.
 */
function ships(relativePath, slotNames) {
  const name = posix.basename(relativePath);
  if (name.startsWith(".")) return false;
  if (name === "SConstruct" || name === "SConstruct.meta") return false;
  const inPlugins = relativePath.startsWith(`${posix.join("Runtime", "Plugins")}/`);
  return !(inPlugins && slotNames.has(posix.basename(assetOf(relativePath) ?? relativePath)));
}

function main() {
  const args = process.argv.slice(2);
  const allowPartial = args.includes("--allow-partial");
  const pluginsDir = flagValue(args, "--plugins") ?? join(PACKAGE_DIR, PLUGINS_DIR);
  const outDir = flagValue(args, "--out") ?? "dist";

  const version = JSON.parse(readFileSync(VERSION_FROM, "utf8")).version;
  const declared = declaredSlots(readFileSync(join(PACKAGE_DIR, "SConstruct"), "utf8"));
  const slotNames = new Set(declared.map(({ slot }) => posix.basename(slot)));

  // Artifacts come down one directory per platform (`actions/download-artifact`
  // without a name), each holding its `Runtime/Plugins/` tree, so the plugins
  // are found rather than listed: what matters is the slot path, which is what
  // the .meta templates and Unity's import both resolve against.
  const present = filesUnder(pluginsDir);
  const plan = planPlugins(
    declared,
    present.map((path) => toPosix(path)),
  );

  for (const file of plan.extra)
    console.warn(`pack-upm: in no slot the SConstruct names — ${file}`);
  if (plan.duplicate.length > 0) {
    console.error(
      `pack-upm: two builds of the same slot under ${pluginsDir}:\n  ${plan.duplicate.join("\n  ")}\n` +
        "Only one would reach the tarball, and nothing would say which.",
    );
    process.exit(1);
  }
  if (plan.missing.length > 0) {
    const list = plan.missing.join("\n  ");
    if (!allowPartial) {
      console.error(
        `pack-upm: the SConstruct names plugin slots that were not built:\n  ${list}\n` +
          "Every platform in it must be in the tarball, or that platform silently has no SDK. " +
          "Pass --allow-partial for a local build you are only testing on this machine.",
      );
      process.exit(1);
    }
    console.warn(`pack-upm: --allow-partial, packing without:\n  ${list}`);
  }

  const staging = join(outDir, "upm");
  rmSync(staging, { recursive: true, force: true });
  const root = join(staging, "package");
  mkdirSync(root, { recursive: true });

  for (const path of filesUnder(PACKAGE_DIR)) {
    const rel = toPosix(relative(PACKAGE_DIR, path));
    if (!ships(rel, slotNames)) continue;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(path, join(root, rel));
  }
  writeFileSync(
    join(root, "package.json"),
    stampVersion(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"), version),
  );
  const byPath = new Map(present.map((path) => [toPosix(path), path]));
  for (const { slot, binary, meta } of plan.included) {
    const target = join(root, PLUGINS_DIR, ...slot.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(byPath.get(binary), target);
    cpSync(byPath.get(meta), `${target}.meta`);
  }

  // `npm pack` rather than a tar of our own: a `.tgz` with a `package/` root
  // is exactly what `Packages/manifest.json` accepts by `file:`, and npm is
  // what defines that layout.
  mkdirSync(outDir, { recursive: true });
  const tarball = tarballName(version);
  rmSync(join(outDir, tarball), { force: true });
  execFileSync("npm", ["pack", "--pack-destination", join("..", ".."), "--silent"], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });

  // The tarball is the contract, so it is what gets checked: every slot the
  // plan included has to be readable back out of it, .meta beside it.
  const listing = execFileSync("tar", ["-tzf", join(outDir, tarball)], { encoding: "utf8" });
  const shipped = new Set(listing.split("\n").filter(Boolean));
  for (const { slot } of plan.included) {
    for (const entry of [slot, `${slot}.meta`]) {
      const path = posix.join("package", toPosix(PLUGINS_DIR), entry);
      if (!shipped.has(path)) {
        console.error(`pack-upm: ${path} did not make it into ${tarball}`);
        process.exit(1);
      }
    }
  }
  console.log(`pack-upm: ${join(outDir, tarball)} — ${plan.included.length} plugins, v${version}`);
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

function toPosix(path) {
  return path.split(sep).join(posix.sep);
}

if (basename(process.argv[1] ?? "") === "pack-upm.mjs") main();

export { declaredSlots, planPlugins, ships, stampVersion, tarballName };
