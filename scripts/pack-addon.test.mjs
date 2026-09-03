import { describe, expect, it } from "vitest";
import { addonZipName, declaredLibraries, planLibraries, stampVersion } from "./pack-addon.mjs";

const GDEXTENSION = `[configuration]

entry_symbol = "zabloo_library_init"
compatibility_minimum = "4.4"

[libraries]

; a comment
macos.debug = "res://addons/zabloo/bin/libzabloo.macos.template_debug.universal.dylib"
macos.release = "res://addons/zabloo/bin/libzabloo.macos.template_release.universal.dylib"
linux.debug.x86_64 = "res://addons/zabloo/bin/libzabloo.linux.template_debug.x86_64.so"
linux.release.x86_64 = "res://addons/zabloo/bin/libzabloo.linux.template_release.x86_64.so"
web.debug.wasm32 = "res://addons/zabloo/bin/libzabloo.web.template_debug.wasm32.wasm"
web.release.wasm32 = "res://addons/zabloo/bin/libzabloo.web.template_release.wasm32.wasm"
`;

const DESKTOP = [
  "libzabloo.macos.template_debug.universal.dylib",
  "libzabloo.macos.template_release.universal.dylib",
  "libzabloo.linux.template_debug.x86_64.so",
  "libzabloo.linux.template_release.x86_64.so",
];

describe("declaredLibraries", () => {
  it("reads the file names out of the [libraries] section", () => {
    expect(declaredLibraries(GDEXTENSION).map((library) => library.file)).toEqual([
      ...DESKTOP,
      "libzabloo.web.template_debug.wasm32.wasm",
      "libzabloo.web.template_release.wasm32.wasm",
    ]);
  });

  it("takes the platform from the key, not from the file name", () => {
    expect(declaredLibraries(GDEXTENSION).map((library) => library.platform)).toEqual([
      "macos",
      "macos",
      "linux",
      "linux",
      "web",
      "web",
    ]);
  });

  it("ignores the configuration keys and the comments", () => {
    const files = declaredLibraries(GDEXTENSION).map((library) => library.file);
    expect(files.some((file) => file.includes("zabloo_library_init"))).toBe(false);
    expect(files.some((file) => file.includes("4.4"))).toBe(false);
  });
});

describe("planLibraries", () => {
  it("packs what was built and reports web as skipped, not missing", () => {
    const plan = planLibraries(GDEXTENSION, DESKTOP);
    expect(plan.included).toEqual(DESKTOP);
    expect(plan.missing).toEqual([]);
    expect(plan.skipped).toEqual([
      "libzabloo.web.template_debug.wasm32.wasm",
      "libzabloo.web.template_release.wasm32.wasm",
    ]);
  });

  // The whole point of reading the .gdextension: a platform Godot will look for
  // and not find is an install that silently has no addon there.
  it("a non-web library the .gdextension names and the build did not produce is missing", () => {
    const plan = planLibraries(GDEXTENSION, DESKTOP.slice(0, 2));
    expect(plan.missing).toEqual([
      "libzabloo.linux.template_debug.x86_64.so",
      "libzabloo.linux.template_release.x86_64.so",
    ]);
  });

  // The editor is a debug build: a zip with only release binaries installs and
  // then has no ZablooView in the Add Node dialog.
  it("a release-only build is missing every debug library", () => {
    const releases = DESKTOP.filter((name) => name.includes("template_release"));
    expect(planLibraries(GDEXTENSION, releases).missing).toEqual([
      "libzabloo.macos.template_debug.universal.dylib",
      "libzabloo.linux.template_debug.x86_64.so",
    ]);
  });

  it("a binary nothing declares is reported as extra rather than packed", () => {
    const plan = planLibraries(GDEXTENSION, [...DESKTOP, "libzabloo.bsd.template_release.so"]);
    expect(plan.extra).toEqual(["libzabloo.bsd.template_release.so"]);
    expect(plan.included).toEqual(DESKTOP);
  });

  // Two artifacts carrying the same name are two builds of one library, and only
  // one of them can reach the zip.
  it("the same file name from two places is a duplicate", () => {
    const plan = planLibraries(GDEXTENSION, [...DESKTOP, DESKTOP[0]]);
    expect(plan.duplicate).toEqual([DESKTOP[0]]);
  });

  it("nothing is duplicate when every name appears once", () => {
    expect(planLibraries(GDEXTENSION, DESKTOP).duplicate).toEqual([]);
  });
});

describe("stampVersion", () => {
  it("sets the version line and leaves the rest of plugin.cfg alone", () => {
    const cfg = '[plugin]\n\nname="Zabloo UI"\nversion="0.1.0"\nscript="zabloo_plugin.gd"\n';
    const stamped = stampVersion(cfg, "0.2.0");
    expect(stamped).toContain('version="0.2.0"');
    expect(stamped).not.toContain("0.1.0");
    expect(stamped).toContain('name="Zabloo UI"');
    expect(stamped).toContain('script="zabloo_plugin.gd"');
  });

  it("throws rather than pack an unversioned addon", () => {
    expect(() => stampVersion('[plugin]\nname="Zabloo UI"\n', "0.2.0")).toThrow(/version=/);
  });
});

describe("addonZipName", () => {
  it("names the zip after the fixed group's version", () => {
    expect(addonZipName("0.2.0")).toBe("zabloo-godot-addon-0.2.0.zip");
  });
});
