/**
 * Escape leaves zen mode.
 *
 * Zen hides every control there is, so the way out has to be the key everyone
 * already tries — but Escape is also the key that closes a menu and the key that
 * cancels an edit, and stealing it from either would be worse than not having the
 * shortcut at all. So it stands down in two cases: when the focus is in a field
 * (the canvas is a live UI and the developer may well be typing into it), and
 * when a Radix surface is open. Radix portals its menus to `<body>`, which is why
 * the check is a query on the whole document rather than on the shell, and why it
 * is `[data-state=open]` — the attribute every Radix primitive marks itself with
 * — rather than a list of the ones the chrome happens to use today.
 *
 * The listener only exists while zen is on. Nothing to stand down from otherwise,
 * and a global Escape handler that is always installed is exactly the kind of
 * thing that eats a keystroke somewhere else six months from now.
 */

import { useEffect } from "react";
import { useStore } from "@/store";

/** Anything the user could be typing into. */
function isTyping(element: Element | null): boolean {
  if (element === null) return false;
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

function useZenShortcuts(): void {
  // Narrow selectors, not `useLayout()`: see the note in `AppShell`.
  const zen = useStore((state) => state.layout.zen);
  const setZen = useStore((state) => state.setZen);

  useEffect(() => {
    if (!zen) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (isTyping(document.activeElement)) return;
      if (document.querySelector("[data-state=open]") !== null) return;
      setZen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zen, setZen]);
}

export { useZenShortcuts };
