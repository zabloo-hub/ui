import { describe, expect, it } from "vitest";
import { changelogSection, parseReleaseTag } from "./github-releases.mjs";

const CHANGELOG = `# @zabloo/cli

## 0.2.0

### Minor Changes

- [#82](https://github.com/zabloo-hub/ui/pull/82) Thanks @zamoks95! - New dev preview UI.

### Patch Changes

- [#86](https://github.com/zabloo-hub/ui/pull/86) Thanks @zamoks95! - The preview server no longer dies.

## 0.1.0

### Minor Changes

- First release.
`;

describe("changelogSection", () => {
  it("returns the section of one version, without its heading", () => {
    const section = changelogSection(CHANGELOG, "0.2.0");
    expect(section).toContain("### Minor Changes");
    expect(section).toContain("New dev preview UI.");
    expect(section).toContain("The preview server no longer dies.");
    expect(section).not.toContain("## 0.2.0");
  });

  it("stops at the next version — the sub-headings inside stay, the next release does not", () => {
    const section = changelogSection(CHANGELOG, "0.2.0");
    expect(section).not.toContain("0.1.0");
    expect(section).not.toContain("First release.");
  });

  it("reads the last section to the end of the file", () => {
    expect(changelogSection(CHANGELOG, "0.1.0")).toBe("### Minor Changes\n\n- First release.");
  });

  it("is null for a version the changelog does not have", () => {
    expect(changelogSection(CHANGELOG, "9.9.9")).toBeNull();
  });
});

describe("parseReleaseTag", () => {
  it("reads a scoped and an unscoped package tag", () => {
    expect(parseReleaseTag("@zabloo/cli@0.2.0")).toEqual({ name: "@zabloo/cli", version: "0.2.0" });
    expect(parseReleaseTag("create-zabloo-app@0.1.1")).toEqual({
      name: "create-zabloo-app",
      version: "0.1.1",
    });
  });

  it("keeps a prerelease suffix", () => {
    expect(parseReleaseTag("@zabloo/format@1.0.0-beta.2")?.version).toBe("1.0.0-beta.2");
  });

  it("is null for any tag that is not a release", () => {
    expect(parseReleaseTag("v1")).toBeNull();
    expect(parseReleaseTag("nightly")).toBeNull();
  });
});
