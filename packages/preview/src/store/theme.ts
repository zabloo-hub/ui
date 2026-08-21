/**
 * Light or dark, chosen by hand and remembered (★). There is no "system" option
 * on purpose: the chrome is a tool you keep open next to an editor, and the
 * design's own default is light — following the OS would flip the tool under
 * someone at sunset with no way to say "no, this one stays light".
 *
 * The canvas is NOT themed by this: what the developer's UI looks like is the
 * developer's business.
 */

import type { Getter, Setter } from "./state";

type Theme = "light" | "dark";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

interface ThemeSlice {
  theme: Theme;
  setTheme(theme: Theme): void;
  toggleTheme(): void;
}

function createThemeSlice(set: Setter, get: Getter): ThemeSlice {
  return {
    theme: "light",
    setTheme: (theme) => set({ theme }),
    toggleTheme: () => set({ theme: get().theme === "light" ? "dark" : "light" }),
  };
}

export type { Theme, ThemeSlice };
export { createThemeSlice, isTheme };
