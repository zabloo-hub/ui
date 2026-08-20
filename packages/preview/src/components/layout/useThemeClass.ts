/**
 * The one place the chrome's theme reaches the DOM: `.dark` and `color-scheme`
 * on `<html>`, following the store.
 *
 * Both, not just the class. The class is what `tokens.css` keys its palette off;
 * `color-scheme` is what tells the BROWSER — the scrollbars, the form controls,
 * the canvas background before anything is drawn on it. `tokens.css` declares it
 * too, on `:root` and `.dark`, and it is set here as well on purpose: the
 * anti-flash script in `index.html` runs before that stylesheet exists, so the
 * inline value is what covers the first paint, and an effect that only moved the
 * class would leave a stale `color-scheme` behind it forever.
 *
 * The canvas is deliberately NOT themed by any of this — what the developer's UI
 * looks like is the developer's business (see `store/theme.ts`).
 */

import { useEffect } from "react";
import { useTheme } from "@/store";

function useThemeClass(): void {
  const { theme } = useTheme();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  }, [theme]);
}

export { useThemeClass };
