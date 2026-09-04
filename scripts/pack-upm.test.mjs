import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { declaredSlots, planPlugins, ships, stampVersion, tarballName } from "./pack-upm.mjs";

// A table in the shape `sdk/unity/SConstruct` keeps its `PLATFORMS`, small
// enough to reason about: two desktop slots and the two that share a file name.
const SCONSTRUCT = `
opts = Variables()

PLATFORMS = {
    "macos": (["libzabloo.dylib"], os.path.join("macOS", "libzabloo.dylib")),
    "windows": (["zabloo.dll", "libzabloo.dll"], os.path.join("Windows", "x86_64", "zabloo.dll")),
    "linux": (["libzabloo.so"], os.path.join("Linux", "x86_64", "libzabloo.so")),
    "android": ([os.path.join("android", "libzabloo.so")], os.path.join("Android", "arm64-v8a", "libzabloo.so")),
}

META_HEAD = """fileFormatVersion: 2
"""
`;

const SLOTS = [
  "macOS/libzabloo.dylib",
  "Windows/x86_64/zabloo.dll",
  "Linux/x86_64/libzabloo.so",
  "Android/arm64-v8a/libzabloo.so",
];

/** What five CI artifacts look like once downloaded: one directory each, the slot path inside. */
function artifacts(slots) {
  return slots.flatMap((slot) => {
    const platform = slot.split("/")[0].toLowerCase();
    return [`unity-plugin-${platform}/${slot}`, `unity-plugin-${platform}/${slot}.meta`];
  });
}

describe("declaredSlots", () => {
  it("reads the slot paths out of the PLATFORMS table", () => {
    expect(declaredSlots(SCONSTRUCT).map((entry) => entry.slot)).toEqual(SLOTS);
  });

  it("takes the platform from the key", () => {
    expect(declaredSlots(SCONSTRUCT).map((entry) => entry.platform)).toEqual([
      "macos",
      "windows",
      "linux",
      "android",
    ]);
  });

  it("is not fooled by an os.path.join inside the candidates list", () => {
    const android = declaredSlots(SCONSTRUCT).find((entry) => entry.platform === "android");
    expect(android.slot).toBe("Android/arm64-v8a/libzabloo.so");
  });

  it("throws rather than pack from a SConstruct with no table", () => {
    expect(() => declaredSlots("env = Environment()\n")).toThrow(/PLATFORMS/);
  });

  // The real file is the contract; the fixture above is only easier to read.
  it("reads the five slots of the real sdk/unity/SConstruct", () => {
    const real = readFileSync(
      join(import.meta.dirname, "..", "sdk", "unity", "SConstruct"),
      "utf8",
    );
    expect(declaredSlots(real).map((entry) => entry.slot)).toEqual([
      "macOS/libzabloo.dylib",
      "Linux/x86_64/libzabloo.so",
      "Windows/x86_64/zabloo.dll",
      "Android/arm64-v8a/libzabloo.so",
      "iOS/libzabloo.a",
    ]);
  });
});

describe("planPlugins", () => {
  const declared = declaredSlots(SCONSTRUCT);

  it("packs every slot that came down with its .meta", () => {
    const plan = planPlugins(declared, artifacts(SLOTS));
    expect(plan.included.map((entry) => entry.slot)).toEqual(SLOTS);
    expect(plan.included[1]).toEqual({
      slot: "Windows/x86_64/zabloo.dll",
      binary: "unity-plugin-windows/Windows/x86_64/zabloo.dll",
      meta: "unity-plugin-windows/Windows/x86_64/zabloo.dll.meta",
    });
    expect(plan.missing).toEqual([]);
    expect(plan.extra).toEqual([]);
    expect(plan.duplicate).toEqual([]);
  });

  // The whole point of reading the SConstruct: a platform Unity will look for
  // and not find is an install that silently has no SDK there.
  it("a slot the SConstruct names and no artifact filled is missing", () => {
    const plan = planPlugins(declared, artifacts(SLOTS.slice(0, 2)));
    expect(plan.missing).toEqual(["Linux/x86_64/libzabloo.so", "Android/arm64-v8a/libzabloo.so"]);
    expect(plan.included.map((entry) => entry.slot)).toEqual(SLOTS.slice(0, 2));
  });

  // A binary and its import settings are one thing: without the .meta, Unity
  // enables the file for every platform, which is not this platform's SDK.
  it("a binary without its .meta is missing, and says which half", () => {
    const present = artifacts(SLOTS).filter(
      (path) => path !== "unity-plugin-macos/macOS/libzabloo.dylib.meta",
    );
    const plan = planPlugins(declared, present);
    expect(plan.missing).toEqual([
      "macOS/libzabloo.dylib.meta (the binary is there, its import settings are not)",
    ]);
    expect(plan.included.map((entry) => entry.slot)).not.toContain("macOS/libzabloo.dylib");
  });

  it("a .meta without its binary is missing too", () => {
    const present = artifacts(SLOTS).filter(
      (path) => path !== "unity-plugin-linux/Linux/x86_64/libzabloo.so",
    );
    expect(planPlugins(declared, present).missing).toEqual([
      "Linux/x86_64/libzabloo.so (only its .meta was built)",
    ]);
  });

  // Linux and Android both ship `libzabloo.so`: the slot path, not the file
  // name, is what tells them apart.
  it("tells the two libzabloo.so apart by their slot", () => {
    const present = artifacts(["Android/arm64-v8a/libzabloo.so"]);
    const plan = planPlugins(declared, present);
    expect(plan.included.map((entry) => entry.slot)).toEqual(["Android/arm64-v8a/libzabloo.so"]);
    expect(plan.missing).toContain("Linux/x86_64/libzabloo.so");
  });

  it("a plugin that sits in no slot is extra, not that platform", () => {
    const present = [
      ...artifacts(SLOTS),
      "unity-plugin-linux/libzabloo.so",
      "unity-plugin-linux/libzabloo.so.meta",
    ];
    const plan = planPlugins(declared, present);
    expect(plan.extra).toEqual([
      "unity-plugin-linux/libzabloo.so",
      "unity-plugin-linux/libzabloo.so.meta",
    ]);
    expect(plan.missing).toEqual([]);
  });

  it("ignores files that are not plugins at all", () => {
    const present = [
      ...artifacts(SLOTS),
      "unity-plugin-macos/macOS.meta",
      "unity-plugin-macos/Linux.meta",
    ];
    const plan = planPlugins(declared, present);
    expect(plan.extra).toEqual([]);
    expect(plan.included).toHaveLength(SLOTS.length);
  });

  // Two artifacts carrying the same slot are two builds of one library, and
  // only one of them can reach the tarball.
  it("the same slot from two places is a duplicate", () => {
    const present = [
      ...artifacts(SLOTS),
      "again/macOS/libzabloo.dylib",
      "again/macOS/libzabloo.dylib.meta",
    ];
    const plan = planPlugins(declared, present);
    expect(plan.duplicate).toEqual(["macOS/libzabloo.dylib"]);
    expect(plan.included.map((entry) => entry.slot)).not.toContain("macOS/libzabloo.dylib");
  });

  it("nothing is duplicate when every slot appears once", () => {
    expect(planPlugins(declared, artifacts(SLOTS)).duplicate).toEqual([]);
  });
});

describe("ships", () => {
  const names = new Set(["libzabloo.dylib", "zabloo.dll", "libzabloo.so", "libzabloo.a"]);

  it("ships the package's sources, tests and their .meta files", () => {
    expect(ships("package.json", names)).toBe(true);
    expect(ships("Runtime/ZablooView.cs", names)).toBe(true);
    expect(ships("Runtime/ZablooView.cs.meta", names)).toBe(true);
    expect(ships("Tests/Golden/GoldenTests.cs", names)).toBe(true);
    expect(ships("Runtime/Plugins/macOS.meta", names)).toBe(true);
  });

  it("leaves the installer and the dotfiles behind", () => {
    expect(ships("SConstruct", names)).toBe(false);
    expect(ships("SConstruct.meta", names)).toBe(false);
    expect(ships("Runtime/Plugins/macOS/.gitkeep", names)).toBe(false);
  });

  // The plugins come from the plan, never from whatever a local install left.
  it("leaves a locally installed plugin and its .meta behind", () => {
    expect(ships("Runtime/Plugins/macOS/libzabloo.dylib", names)).toBe(false);
    expect(ships("Runtime/Plugins/macOS/libzabloo.dylib.meta", names)).toBe(false);
  });
});

describe("stampVersion", () => {
  const manifest = JSON.stringify(
    { name: "com.zabloo.sdk", version: "0.0.0", unity: "2022.3" },
    null,
    2,
  );

  it("sets the version and leaves the rest of package.json alone", () => {
    const stamped = JSON.parse(stampVersion(manifest, "0.3.0"));
    expect(stamped).toEqual({ name: "com.zabloo.sdk", version: "0.3.0", unity: "2022.3" });
  });

  it("ends with a newline, like a file", () => {
    expect(stampVersion(manifest, "0.3.0").endsWith("}\n")).toBe(true);
  });

  it("refuses to stamp a package.json that is not the SDK's", () => {
    expect(() => stampVersion('{"name":"@zabloo/format","version":"0.2.0"}', "0.3.0")).toThrow(
      /not the Unity SDK/,
    );
  });
});

describe("tarballName", () => {
  it("is what npm pack names it, after the fixed group's version", () => {
    expect(tarballName("0.3.0")).toBe("com.zabloo.sdk-0.3.0.tgz");
  });
});
