import { Maximize } from "lucide-react";
import { Button } from "@/components/ui";
import { useStore } from "@/store";

/**
 * The way into zen mode. One-way on purpose: the topbar is the first thing zen
 * unmounts, so this button never gets to draw itself active — the way back out
 * is the floating pill over the stage (`zen/ZenPill.tsx`), and Escape.
 *
 * That is also why it calls `setZen(true)` and not `toggleZen()`, even though a
 * toggle exists for the keyboard shortcut: a control that cannot be seen in one
 * of its two states should not be able to reach it.
 */
function ZenButton() {
  const setZen = useStore((state) => state.setZen);

  return (
    <Button
      data-slot="zen-button"
      variant="ghost"
      size="icon"
      aria-label="Zen mode"
      onClick={() => setZen(true)}
    >
      <Maximize />
    </Button>
  );
}

export { ZenButton };
