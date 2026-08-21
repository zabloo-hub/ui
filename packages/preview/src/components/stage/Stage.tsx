import { type CSSProperties, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { hasFatal, useCaptionParts, useLogicalSize, useStore, useZoom } from "@/store";
import { StalePill } from "./StalePill";
import { useLogicalResize, useStageSize } from "./useStageSize";

/**
 * The stage: a flat surround, a caption, and the one canvas the whole tool
 * exists to show. It owns the element; the renderer that draws on it is mounted
 * by the session (V6), which finds it through `runtime.canvas` and never meets
 * this file.
 *
 * The scaling rule is ZAB-78's, kept exactly: under a fixed preset the canvas
 * keeps its DECLARED CSS size — the renderer lays out against `clientWidth`, so
 * the size is a statement about layout, not about paint — and a `transform`
 * shrinks what you see. Never above 1: a 720p view blown up to a 4K monitor
 * would be showing you resampling instead of your UI.
 *
 * Three boxes where the artboard draws one, because a `transform` does not
 * shrink a layout box. A 1280×800 frame in a 630px stage still CLAIMS 800px and
 * would shove the caption off the top of the screen, so the frame goes inside a
 * box sized to what it visually becomes (`W×zoom`), centred — and the centring
 * is what makes the `center` origin land the scaled frame exactly on that box.
 * Which is also why the pill is a sibling of the frame rather than a child: the
 * box has the frame's on-screen geometry without its scale, so the pill's 11.5px
 * stay 11.5px at 60% zoom instead of becoming 7.
 *
 * `Fit window` is the case with no scaling in it at all: the canvas simply takes
 * the area, and the frame drops its border, radius and shadow. Full bleed, and
 * honest with it: a border would eat two pixels the caption has already claimed
 * the canvas is laid out at.
 */
function Stage() {
  const zen = useStore((state) => state.layout.zen);
  const fit = useStore((state) => state.viewport.preset === "fit");
  const stale = useStore((state) => state.connection === "stale" || hasFatal(state));
  const setCanvas = useStore((state) => state.setCanvas);
  const caption = useCaptionParts();
  const size = useLogicalSize();
  const zoom = useZoom();

  const area = useStageSize();
  useLogicalResize(size);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // A mount effect and a stable ref rather than a callback ref: an inline
  // callback is a new identity on every render, and React would detach and
  // reattach it each time — sixty writes a second into the one field the session
  // subscribes to, for a canvas that never moved.
  useEffect(() => {
    setCanvas(canvasRef.current);
    return () => setCanvas(null);
  }, [setCanvas]);

  // The scaled box the frame occupies, and the frame's own declared size.
  const box: CSSProperties = fit ? {} : { width: size.width * zoom, height: size.height * zoom };
  const frame: CSSProperties = fit
    ? {}
    : {
        width: size.width,
        height: size.height,
        transform: `scale(${zoom})`,
        transformOrigin: "center",
      };
  const canvas: CSSProperties = fit
    ? { width: "100%", height: "100%" }
    : { width: size.width, height: size.height };

  return (
    <div
      data-slot="stage"
      className="flex h-full w-full flex-col items-center justify-center gap-[10px] bg-stage"
    >
      {!zen && (
        <div data-slot="stage-caption" className="font-mono text-caption text-muted-foreground">
          {[caption.preset, caption.size, caption.dpr, caption.zoom]
            .filter((part) => part !== null)
            .join(" · ")}
        </div>
      )}
      <div
        ref={area}
        data-slot="stage-area"
        className="flex min-h-0 w-full flex-1 items-center justify-center"
      >
        <div
          data-slot="stage-box"
          className={cn("relative flex items-center justify-center", fit && "h-full w-full")}
          style={box}
        >
          <div
            data-slot="stage-frame"
            className={cn(
              "relative shrink-0 overflow-hidden",
              fit ? "h-full w-full" : "rounded-md border shadow-frame",
            )}
            style={frame}
          >
            <canvas ref={canvasRef} className="block" style={canvas} />
            {stale && (
              // Over the last good render, not instead of it.
              <div
                data-slot="stage-veil"
                className="absolute inset-0 z-10 bg-veil backdrop-saturate-[0.2]"
              />
            )}
          </div>
          {stale && <StalePill />}
        </div>
      </div>
    </div>
  );
}

export { Stage };
