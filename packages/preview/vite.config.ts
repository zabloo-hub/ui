/**
 * The preview chrome's build, dev server and test runner, in one config.
 *
 * Three things here are not boilerplate:
 *
 * 1. Workspace deps resolve to their SOURCES, exactly like `tsconfig.base.json`
 *    and `vitest.shared.ts` do (ZAB-62). Without it `pnpm --filter @zabloo/preview
 *    dev` on a fresh clone dies the moment something imports `@zabloo/renderer-web`,
 *    because `dist/` is not there until someone runs `pnpm build`. The aliases are
 *    anchored (`^…$`) for the same reason they are over there: `@zabloo/renderer-web/global`
 *    is the built IIFE bundle, and a prefix match would rewrite it into `src/index.ts`.
 *
 * 2. The dev server proxies the three endpoints of a real `zabloo dev` (ZAB-82).
 *    That is what lets the chrome be developed against live envelopes and live
 *    reloads without rebuilding the CLI — until V18 teaches the CLI to serve this
 *    app's `dist/` itself.
 *
 * 3. `build.chunkSizeWarningLimit` is raised, with the measurement that justifies
 *    it written next to it (ZAB-107).
 */

import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const src = (pkg: string): string => here(`../${pkg}/src/index.ts`);

/** Where `zabloo dev` puts its preview server by default (`--preview-port` moves it). */
const DEV_SERVER = "http://localhost:5078";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${here("./src")}/` },
      { find: /^@zabloo\/format$/, replacement: src("format") },
      { find: /^@zabloo\/react$/, replacement: src("react") },
      { find: /^@zabloo\/renderer-web$/, replacement: src("renderer-web") },
    ],
  },
  build: {
    // Vite warns above 500 kB, and this bundle is 1.084,5 kB. The warning was
    // firing on every single build, which is the state in which a warning stops
    // being read — so it is raised HERE, with the measurement that says what is
    // in there, rather than left to be ignored (ZAB-107).
    //
    // Measured by source map over the production bundle, 2026-08-22:
    //
    //   534,9 kB  49,8%  renderer-web/src/generated/font.ts
    //   174,1 kB  16,2%  react-dom
    //   115,3 kB  10,7%  the rest of @zabloo/renderer-web (stbtt wasm: 23,7 kB)
    //    41,9 kB   3,9%  components/ + components/ui/
    //    27,4 kB   2,6%  tailwind-merge
    //
    // Half the bundle is one file: Liberation Sans, 410 kB of TTF embedded as
    // base64 so that `@zabloo/renderer-web` can ship a self-contained IIFE that
    // rasterizes text with no network. That is a deliberate decision over there
    // and it is the ONLY thing that would meaningfully move this number — not
    // the chrome, and not `/kit`, which is 19,6 kB (1,8%) and now loads from its
    // own chunk anyway. Until the font stops travelling as a string, a smaller
    // limit here would be an alarm with nothing behind it.
    //
    // 1200 rather than something comfortable: it clears what is measured and
    // little else, so real growth still rings.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    proxy: {
      "/envelope": { target: DEV_SERVER, ws: false },
      "/asset": { target: DEV_SERVER, ws: false },
      // The reload channel is SSE, not a WebSocket (F10 decision): one long-lived
      // response the server writes to forever. `ws: false` keeps the proxy from
      // trying to upgrade it, and dropping `accept-encoding` keeps the target from
      // answering with a compressed body — which is the thing that would sit in a
      // buffer instead of arriving event by event.
      "/events": {
        target: DEV_SERVER,
        ws: false,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("accept-encoding");
          });
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Vitest's default is 5s, which is not a budget for the work a test does
    // here — it is that work plus whatever the other workers are doing on the
    // same machine. A `userEvent` click waits on real timers, and in a jsdom
    // suite this size the slowest of them lands in a second or two on an idle
    // box and past five on a busy one: ZAB-105 added eleven files and turned
    // two green tests amber without touching either. Raised rather than worked
    // around per test, because a timeout is only there to catch a HUNG test and
    // none of these is one.
    testTimeout: 20_000,
  },
});
