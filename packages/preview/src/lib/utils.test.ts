import { cn } from "@/lib/utils";

/**
 * The regression this file exists for: the theme's type scale is named, not
 * numbered, so tailwind-merge reads `text-ui` as a colour and lets the next
 * `text-<colour>` delete it. It fails silently — the class is simply not in the
 * output — which is why it is pinned here rather than left to the eye.
 */
describe("cn", () => {
  it("keeps a named font size next to a colour", () => {
    expect(cn("text-tag", "text-muted-foreground")).toBe("text-tag text-muted-foreground");
    expect(cn("text-ui", "font-medium", "text-foreground")).toBe(
      "text-ui font-medium text-foreground",
    );
    expect(cn("text-caption", "text-zinc-100")).toBe("text-caption text-zinc-100");
  });

  it("still lets one font size win over another", () => {
    expect(cn("text-ui", "text-log")).toBe("text-log");
    expect(cn("text-tag", "text-sm")).toBe("text-sm");
  });

  it("treats the theme's shadows as one group", () => {
    expect(cn("shadow-control", "shadow-menu")).toBe("shadow-menu");
    expect(cn("shadow-panel", "shadow-control")).toBe("shadow-control");
  });

  it("leaves the rest of Tailwind alone", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("bg-card", "bg-muted")).toBe("bg-muted");
  });
});
