/**
 * The preview chrome's build, dev server and test runner, in one config.
 *
 * Two things here are not boilerplate:
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
  },
});
