/**
 * check-links — every relative link in the docs resolves, anchors included (ZAB-79).
 *
 * ZAB-75 swept the docs by hand and its commit claimed "the repo's only broken
 * anchor, in scrollview.md". Four were left: `toggle.md` was pinning anchors with
 * `{#radiogroup}` / `{#select}`, a syntax GitHub does not implement — it renders the
 * `{#…}` as literal title text and slugs the whole heading — so four links across
 * three pages pointed at anchors that never existed. A hand sweep cannot hold this
 * line; the docs are 60+ files that cross-reference each other constantly.
 *
 * It reimplements GitHub's slugger rather than shelling out to a link checker,
 * because the anchors are the half that actually broke and off-the-shelf checkers
 * either skip them or bring a dependency tree to a repo that has none in `scripts/`.
 *
 * Two rules it gets right that a naive checker gets wrong:
 *
 * - **A link to a DIRECTORY is valid** (`../examples`, `.github/ISSUE_TEMPLATE`):
 *   GitHub serves its listing. Treating those as misses would have reported 13
 *   healthy links as broken and buried the 4 real ones.
 * - **Anchors are only checked against `.md` targets.** A link into `view.ts` is a
 *   line-number fragment or a symbol GitHub resolves itself, not a heading here.
 *
 * Usage: `node scripts/check-links.mjs` (`pnpm docs:links`). Exits 1 on the first
 * failing run, listing every broken link as `file:line → target`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Tracked markdown only: an untracked scratch file is not part of the docs. */
const files = execFileSync("git", ["ls-files", "*.md"], { cwd: repo, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

/**
 * GitHub's heading slug: lowercase, drop everything that is not a letter, a digit,
 * `_`, `-` or a space, then spaces to hyphens. Unicode-aware on purpose — a heading
 * with an accent keeps it in the slug, and `\w` would not.
 */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\- ]/gu, "")
    .replace(/ /g, "-");
}

/** Strips fenced code blocks, keeping line numbers intact so reports stay accurate. */
function withoutFences(source) {
  let fenced = false;
  return source.split("\n").map((line) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      fenced = !fenced;
      return "";
    }
    return fenced ? "" : line;
  });
}

/** The anchors a page offers, in GitHub's order — duplicates get `-1`, `-2`, … */
function anchorsOf(file) {
  const anchors = new Set();
  for (const line of withoutFences(readFileSync(join(repo, file), "utf8"))) {
    const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const base = slugify(heading[1]);
    if (!base) continue;
    let slug = base;
    for (let n = 1; anchors.has(slug); n++) slug = `${base}-${n}`;
    anchors.add(slug);
  }
  return anchors;
}

const anchorsByFile = new Map(files.map((file) => [file, anchorsOf(file)]));

/**
 * The link targets on one line: inline `[t](url)` plus the reference definitions
 * `[label]: url` that `[t][label]` resolves through. Inline code spans are removed
 * first — a link inside backticks is prose about a link, not a link.
 */
function targetsOn(line) {
  const prose = line.replace(/`[^`]*`/g, "");
  const targets = [];
  const definition = /^\s{0,3}\[[^\]]+\]:\s*(\S+)/.exec(prose);
  if (definition) targets.push(definition[1]);
  for (const [, target] of prose.matchAll(/\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g)) {
    targets.push(target);
  }
  return targets;
}

/** Absolute URLs and in-page-only protocols: not ours to resolve. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

const broken = [];
for (const file of files) {
  withoutFences(readFileSync(join(repo, file), "utf8")).forEach((line, index) => {
    for (const target of targetsOn(line)) {
      if (EXTERNAL.test(target)) continue;
      const hash = target.indexOf("#");
      const path = decodeURIComponent(hash === -1 ? target : target.slice(0, hash));
      const anchor = hash === -1 ? "" : decodeURIComponent(target.slice(hash + 1));
      const at = { file, line: index + 1, target };

      let destination = file;
      if (path) {
        // Repo-absolute (`/docs/x.md`) and relative alike, always back to a repo path.
        const absolute = path.startsWith("/")
          ? join(repo, path)
          : resolve(repo, dirname(file), path);
        destination = relative(repo, absolute).split(sep).join(posix.sep);
        let stats;
        try {
          stats = statSync(absolute);
        } catch {
          broken.push({ ...at, why: "no such file or directory" });
          continue;
        }
        // A directory link is valid — GitHub serves its listing — and has no headings.
        if (stats.isDirectory() || !destination.endsWith(".md")) continue;
      }

      if (!anchor) continue;
      const anchors = anchorsByFile.get(destination) ?? anchorsOf(destination);
      if (!anchors.has(anchor)) {
        broken.push({ ...at, why: `no heading in ${destination} slugs to "${anchor}"` });
      }
    }
  });
}

if (broken.length > 0) {
  console.error(`${broken.length} broken link(s) across ${files.length} markdown files:\n`);
  for (const { file, line, target, why } of broken) {
    console.error(`  ${file}:${line} → ${target}\n    ${why}`);
  }
  console.error("");
  process.exit(1);
}

console.log(
  `check-links: ${files.length} markdown files, every relative link and anchor resolves.`,
);
