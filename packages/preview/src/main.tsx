import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import "@/styles/globals.css";

/**
 * Two entry points, two chunks. `/kit` renders the UI kit (V17) — every chrome
 * component in every state, which is how the redesign gets reviewed against the
 * artboards without driving the real preview into each state by hand.
 *
 * A pathname check rather than a router: there are exactly two pages, and the
 * server that will host this in V18 already has to fall back to `index.html`.
 *
 * The kit comes in through `import()` (ZAB-107) so that it lands in its own
 * chunk. Not because it weighs anything — measured, `kit/` and its 20 cells were
 * 19,6 KB of the 1.103 KB bundle they came out of, 1,8% — but because it is a
 * design-review page that nobody who installs `@zabloo/cli` will ever open, and
 * a page nobody opens has no business in the bundle that every preview parses.
 * What the bundle actually weighs is written down next to
 * `chunkSizeWarningLimit` in `vite.config.ts`; splitting the kit does not move
 * it, and was never going to.
 *
 * `fallback={null}` and not a spinner: the chunk comes off a localhost server in
 * the same breath as the one that asked for it, and a flash of "Loading…" would
 * be the only thing that ever made it look slow.
 */
const Kit = lazy(() => import("@/kit/Kit").then((module) => ({ default: module.Kit })));

const root = document.getElementById("root");
if (!root) throw new Error("preview: #root is missing from index.html");

// Trailing slashes stripped: the server answers `/kit/` with the same HTML, and
// an exact match would boot the app on it instead of the kit.
const page = window.location.pathname.replace(/\/+$/, "") || "/";

createRoot(root).render(
  <StrictMode>
    {page === "/kit" ? (
      <Suspense fallback={null}>
        <Kit />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
