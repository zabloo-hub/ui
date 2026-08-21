import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui";
import { useTheme } from "@/store";

/**
 * Light or dark, as one button that shows where you are rather than where you
 * would go: the sun means "this is the light theme", and the artboards paint the
 * button toggled — muted on `--accent` — once dark is on.
 *
 * That paint is `aria-pressed`, which the Button primitive already dresses, so
 * the state is announced and drawn by the same attribute instead of a class that
 * agrees with an aria attribute by hand. The label says the action, because a
 * label that repeated the state would leave a screen reader with no way to know
 * what pressing it does.
 *
 * Nothing here touches `<html>`: putting the class on the document is V16's
 * `useThemeClass`, and this only ever writes the store.
 */
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";

  return (
    <Button
      data-slot="theme-toggle"
      variant="ghost"
      size="icon"
      aria-pressed={dark}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={toggleTheme}
    >
      {dark ? <Moon /> : <Sun className="size-[15px]" />}
    </Button>
  );
}

export { ThemeToggle };
