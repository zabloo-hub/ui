/**
 * The kit's own light/dark switch. Local state and `<html>`, never the store.
 *
 * `.dark` goes on the document element rather than on a wrapper inside the page
 * for the reason the ticket gives: it is what the chrome actually does
 * (`useThemeClass`), so the kit is looking at the same cascade the app is, down
 * to the scrollbars — a `.dark` scoped to a div would leave the page around the
 * card in the other theme and quietly re-root every Radix portal outside it.
 *
 * The seed is read off the class already there, which `index.html` sets from the
 * remembered preference before the first paint: opening `/kit` in a dark setup
 * must not flash light and then agree with itself. From then on it is this
 * page's own toggle — nothing is written back, so flipping the kit cannot change
 * the theme the tool reopens in.
 */

import { useCallback, useEffect, useState } from "react";
import type { Theme } from "@/store";

interface KitTheme {
  theme: Theme;
  toggle: () => void;
}

function useKitTheme(): KitTheme {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  }, []);

  return { theme, toggle };
}

export type { KitTheme };
export { useKitTheme };
