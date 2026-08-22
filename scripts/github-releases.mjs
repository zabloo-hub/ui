// One GitHub Release per release tag on HEAD, carrying that package's changelog
// section. Runs after `changeset publish` pushed its tags (release.yml):
// `changeset publish` names a tag `<package>@<version>` per published package,
// and writes the matching `## <version>` section into the package's CHANGELOG.md
// during the Version Packages PR — this joins the two.
//
// Idempotent: a tag that already has a Release is skipped, so a re-run of the
// job after a partial failure creates only what is missing.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGES_DIR = "packages";

/** A release tag as `changeset publish` writes it: `@zabloo/cli@0.2.0`, `create-zabloo-app@0.1.1`. */
const RELEASE_TAG = /^(?<name>@?[^@]+)@(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * The `## <version>` section of a changelog, without its heading, or null when
 * the version is not in it. Sections end at the next `## ` heading — the
 * per-change `### Minor Changes` headings inside one stay.
 */
function changelogSection(markdown, version) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return body.length === 0 ? null : body;
}

/** A parsed release tag, or null for any other tag. */
function parseReleaseTag(tag) {
  const match = RELEASE_TAG.exec(tag);
  return match === null ? null : { name: match.groups.name, version: match.groups.version };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
}

/** Package name → directory, read from the `package.json` of every directory under `packages/`. */
function packageDirs() {
  return new Map(
    readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(PACKAGES_DIR, entry.name))
      .map((dir) => [JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name, dir]),
  );
}

function releaseExists(tag) {
  try {
    gh(["release", "view", tag]);
    return true;
  } catch {
    return false;
  }
}

function main() {
  const dirs = packageDirs();
  const tags = git("tag", "--points-at", "HEAD")
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

  const releases = tags.flatMap((tag) => {
    const parsed = parseReleaseTag(tag);
    if (parsed === null) return [];
    const dir = dirs.get(parsed.name);
    if (dir === undefined) {
      console.warn(`github-releases: ${tag} names no package under ${PACKAGES_DIR}/ — skipped`);
      return [];
    }
    return [{ tag, ...parsed, dir }];
  });

  if (releases.length === 0) {
    console.log("github-releases: no release tags on HEAD — nothing to do");
    return;
  }

  for (const release of releases) {
    if (releaseExists(release.tag)) {
      console.log(`github-releases: ${release.tag} already has a Release — skipped`);
      continue;
    }
    const changelog = readFileSync(join(release.dir, "CHANGELOG.md"), "utf8");
    const notes =
      changelogSection(changelog, release.version) ??
      `See ${release.dir}/CHANGELOG.md for ${release.version}.`;
    gh(["release", "create", release.tag, "--title", release.tag, "--notes-file", "-"], notes);
    console.log(`github-releases: created ${release.tag}`);
  }
}

if (process.argv[1]?.endsWith("github-releases.mjs")) main();

export { changelogSection, parseReleaseTag };
