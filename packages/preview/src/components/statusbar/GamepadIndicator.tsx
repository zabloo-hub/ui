import { Gamepad2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Whether the browser has admitted to a gamepad, and the tooltip that says what
 * one is good for here.
 *
 * READ THE RULE BEFORE TRUSTING THE ICON (ZAB-47): a page is not told about a
 * gamepad until the first button press on it — `navigator.getGamepads()` returns
 * nothing and `gamepadconnected` never fires — because a list of attached
 * hardware is a fingerprint. So the faint icon does NOT mean "no gamepad": it
 * means "no gamepad has spoken yet", and the way to make it light up is to press
 * a button. Anything built on top of this must treat the off state as unknown
 * rather than absent, or it will refuse to poll a pad that is sitting right there.
 *
 * The `<TooltipProvider>` is local, for the reason it is in `DprControl`: Radix
 * nests them, so this keeps working unchanged the day the shell mounts a global
 * one, and the indicator is whole on its own.
 */
function GamepadIndicator() {
  const connected = useGamepadConnected();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-slot="gamepad-indicator"
            data-connected={connected}
            aria-label={connected ? "Gamepad connected" : "No gamepad detected"}
            className={cn(
              "rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring",
              connected ? "text-indigo" : "text-faint",
            )}
          >
            {/* The design draws a pad wider than it is tall (16×11), so the icon
                keeps that footprint rather than lucide's square box. */}
            <Gamepad2 aria-hidden="true" className="h-[11px] w-[15px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          d-pad / stick: focus · A: press
          <br />
          B: back · right stick: scroll
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Any pad the browser is currently willing to name. */
function hasGamepad(): boolean {
  const pads = navigator.getGamepads?.() ?? [];
  return pads.some((pad) => pad?.connected === true);
}

/**
 * The two events plus one read at mount — a pad pressed before this component
 * existed has already fired its `gamepadconnected` and will not fire it again.
 *
 * The connect side takes the event at its word instead of re-reading the API,
 * which is the honest translation of what it announces. The disconnect side does
 * re-read: the event names the pad that left, not what is left, and unplugging
 * one of two controllers must not turn the icon off.
 */
function useGamepadConnected(): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const connect = (): void => setConnected(true);
    const disconnect = (): void => setConnected(hasGamepad());

    setConnected(hasGamepad());
    window.addEventListener("gamepadconnected", connect);
    window.addEventListener("gamepaddisconnected", disconnect);
    return () => {
      window.removeEventListener("gamepadconnected", connect);
      window.removeEventListener("gamepaddisconnected", disconnect);
    };
  }, []);

  return connected;
}

export { GamepadIndicator };
