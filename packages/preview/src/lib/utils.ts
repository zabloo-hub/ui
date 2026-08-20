import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge has to be told about the theme's own utilities, or it drops
 * them.
 *
 * It resolves conflicts by bucketing a class from its NAME, and its rule for
 * `text-*` is "a t-shirt size or a length is a font size, anything else is a
 * colour". V2's type scale is named rather than numbered (`text-ui`,
 * `text-tag`, … — see `styles/README.md`), so every one of those looks like a
 * colour to it, and `cn("text-tag", "text-muted-foreground")` used to return
 * just `text-muted-foreground`: the size vanished, silently, in about half the
 * primitives. The same goes for the four theme-dependent shadows, which are
 * `@utility` blocks and not `shadow-<size>` — and neither are the three that
 * live in `@theme`, so all seven go in one group or a card ends up wearing two
 * box-shadows.
 *
 * Naming the groups here fixes it once for every `cn()` in the app.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: ["micro", "tag", "label", "code", "caption", "log", "ui", "item", "brand", "stat"],
        },
      ],
      shadow: [
        "shadow-control",
        "shadow-tab",
        "shadow-panel",
        "shadow-frame",
        "shadow-menu",
        "shadow-tooltip",
        "shadow-pill",
      ],
    },
  },
});

/** Merge conditional class names, letting later Tailwind utilities win. */
function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export { cn };
