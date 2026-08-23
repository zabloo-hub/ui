# `zabloo dev` web-first (`--unity` opt-in) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `zabloo dev` levanta solo el preview web por defecto; el push al editor Unity pasa a ser opt-in con `--unity` (modelo React Native / Ionic).

**Architecture:** El cambio vive entero en `@zabloo/cli`: el comando `dev` gana el flag `--unity` y `devLoop` recibe el target Unity como opcional. El push se encapsula en `createPusher(url | null)` (no-op sin target) — la única unidad nueva, cubierta con un test vitest. Scaffold, ejemplos y READMEs se actualizan al nuevo default; la decisión se registra en el log de arquitectura.

**Tech Stack:** TypeScript (ESM), commander, vitest (ya en el monorepo, `pnpm test` por paquete).

**Spec:** `docs/internal/specs/2026-08-10-dev-web-first-design.md`

## Global Constraints

- Repo `ui`: hacer `git pull` antes de empezar; commit + push al terminar (regla del proyecto).
- El protocolo de push (POST `http://127.0.0.1:<port>/zabloo/envelope`) NO cambia; el SDK de Unity no se toca.
- Con `--unity` el comportamiento debe ser idéntico al actual (push por guardado, warning si el editor no responde).
- Sin `--unity`: cero requests de red hacia el puerto del motor y cero warnings.
- Comandos: ejecutar desde `<repo>` salvo indicación contraria.

---

### Task 1: `createPusher` + flag `--unity` en el CLI

**Files:**
- Modify: `packages/cli/src/dev.ts`
- Modify: `packages/cli/src/cli.ts:33-45`
- Test: `packages/cli/src/dev.test.ts` (nuevo)

**Interfaces:**
- Produces: `createPusher(url: string | null): (body: string) => Promise<void>` (export de `dev.ts`); `devLoop(root: string, previewPort: number, unity: { port: number } | null): Promise<void>` (firma nueva — el orden de parámetros cambia: `previewPort` segundo, target Unity tercero).
- Consumes: `startPreviewServer` de `./preview-server.js` (sin cambios).

- [ ] **Step 1: Escribir el test que falla**

Crear `packages/cli/src/dev.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPusher } from "./dev.js";

describe("createPusher", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never touches the network without a target url", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await createPusher(null)('{"v":1}');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs the envelope to the target url", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await createPusher("http://127.0.0.1:5077/zabloo/envelope")('{"v":1}');

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:5077/zabloo/envelope", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"v":1}',
    });
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @zabloo/cli test`
Expected: FAIL — `createPusher` no está exportado (`SyntaxError` / `is not a function`).

- [ ] **Step 3: Implementar `createPusher` y la nueva firma de `devLoop`**

Reemplazar el contenido de `packages/cli/src/dev.ts` por:

```ts
/**
 * `zabloo dev` — the authoring dev loop (decision 2026-08-02, implemented
 * 2026-08-03, web-first since 2026-08-10): watch the project, re-export on
 * change and serve the live web preview. With `--unity`, each export is also
 * pushed to the Unity editor's dev mode over localhost — through the SAME
 * payload/loader path as a manual import or a production hot-update.
 *
 * Each export runs in a child process: user code executes with a clean module
 * graph every time (no stale-module cache, single React instance per run).
 */

import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startPreviewServer } from "./preview-server.js";

export async function devLoop(
  root: string,
  previewPort: number,
  unity: { port: number } | null,
): Promise<void> {
  const unityUrl = unity ? `http://127.0.0.1:${unity.port}/zabloo/envelope` : null;
  const pushToEngine = createPusher(unityUrl);
  let lastEnvelope: string | null = null;
  const preview = startPreviewServer(previewPort, () => lastEnvelope);

  console.log(`zabloo dev: watching ${root}`);
  console.log(`           web preview → ${preview.url}`);
  if (unityUrl) {
    console.log(`           engine push → ${unityUrl} (Unity: menu Zabloo → Dev Mode)`);
  } else {
    console.log(
      "           tip: zabloo dev --unity pushes each save to the Unity editor (Zabloo → Dev Mode)",
    );
  }

  let running = false;
  let queued = false;

  const run = async () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      const outFile = await exportInChild(root);
      if (outFile) {
        lastEnvelope = await readFile(outFile, "utf8");
        preview.notify(); // browser preview reloads via SSE
        await pushToEngine(lastEnvelope); // engine dev mode (no-op without --unity)
      }
    } finally {
      running = false;
      if (queued) {
        queued = false;
        void run();
      }
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 150);
  };

  watch(join(root, "src"), { recursive: true }, schedule);
  watch(root, (_event, filename) => {
    if (filename === "zabloo.config.ts") schedule();
  });

  await run(); // initial export + push
  await new Promise<never>(() => {}); // keep watching until Ctrl+C
}

/** Push an envelope to the engine editor's dev mode; no-op when there is no target. */
export function createPusher(url: string | null): (body: string) => Promise<void> {
  if (!url) return async () => {};
  return async (body) => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      if (res.ok) {
        console.log(`zabloo dev: pushed ${new Date().toLocaleTimeString()} ✔`);
      } else {
        console.error(`zabloo dev: engine rejected the push (${res.status}): ${await res.text()}`);
      }
    } catch {
      console.warn(
        "zabloo dev: exported, but the engine dev mode is not reachable — " +
          "is the Unity editor open with Zabloo → Dev Mode enabled?",
      );
    }
  };
}

/** Runs `zabloo export --porcelain` in a child process; resolves to the outFile. */
function exportInChild(root: string): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [process.argv[1], "export", "--cwd", root, "--porcelain"],
      {
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) {
        const lines = stdout.trim().split("\n");
        resolvePromise(lines[lines.length - 1]?.trim() || null);
      } else {
        console.error("zabloo dev: export failed — fix the error above and save again.");
        resolvePromise(null);
      }
    });
  });
}
```

En `packages/cli/src/cli.ts`, reemplazar el bloque del comando `dev` (líneas 33-45) por:

```ts
program
  .command("dev")
  .description(
    "Watch the project, re-export on change and serve the web preview; add --unity to also push to the Unity editor's dev mode",
  )
  .option("--cwd <dir>", "project root", ".")
  .option("--unity", "also push each export to the Unity editor's dev mode")
  .option("--port <port>", "dev-mode port of the Unity editor (with --unity)", "5077")
  .option("--preview-port <port>", "port of the web preview", "5078")
  .action(async (options: { cwd: string; unity?: boolean; port: string; previewPort: string }) => {
    const { resolve } = await import("node:path");
    const { devLoop } = await import("./dev.js");
    await devLoop(
      resolve(options.cwd),
      Number(options.previewPort),
      options.unity ? { port: Number(options.port) } : null,
    );
  });
```

- [ ] **Step 4: Verificar que pasa + typecheck + build**

Run: `pnpm --filter @zabloo/cli test && pnpm --filter @zabloo/cli typecheck && pnpm --filter @zabloo/cli build`
Expected: 2 tests PASS, typecheck sin errores, build OK.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/dev.ts packages/cli/src/dev.test.ts packages/cli/src/cli.ts
git commit -m "Make zabloo dev web-first: Unity push is now opt-in via --unity"
```

---

### Task 2: Scaffold, ejemplos y READMEs

**Files:**
- Modify: `examples/hello-button/package.json:6-10`
- Modify: `packages/create-zabloo-app/src/index.ts:54,81`
- Modify: `packages/create-zabloo-app/templates/default/README.md:8,14-15`
- Modify: `README.md:56-58`

**Interfaces:**
- Consumes: el flag `--unity` de Task 1 (`zabloo dev --unity`).
- Produces: convención de scripts `dev` (web) / `dev:unity` (web + push a Unity) en proyectos zabloo.

- [ ] **Step 1: `examples/hello-button/package.json` — añadir `dev:unity`**

Reemplazar el bloque `scripts` por:

```json
  "scripts": {
    "dev": "zabloo dev",
    "dev:unity": "zabloo dev --unity",
    "export": "zabloo export",
    "typecheck": "tsc --noEmit"
  },
```

- [ ] **Step 2: `packages/create-zabloo-app/src/index.ts` — scripts y mensaje de éxito**

En el objeto `pkg` (línea ~54), reemplazar:

```ts
    scripts: {
      dev: "zabloo dev",
      build: "zabloo export",
      typecheck: "tsc --noEmit",
    },
```

por:

```ts
    scripts: {
      dev: "zabloo dev",
      "dev:unity": "zabloo dev --unity",
      build: "zabloo export",
      typecheck: "tsc --noEmit",
    },
```

En el mensaje de éxito (línea ~81), reemplazar:

```
    pnpm dev      # web preview → http://localhost:5078 (+ Unity: menu Zabloo → Dev Mode)
    pnpm build    # export → dist/zabloo.ir.json
```

por:

```
    pnpm dev        # web preview → http://localhost:5078
    pnpm dev:unity  # + push each save to the Unity editor (menu Zabloo → Dev Mode)
    pnpm build      # export → dist/zabloo.ir.json
```

- [ ] **Step 3: `packages/create-zabloo-app/templates/default/README.md` — nuevo default**

Reemplazar (línea 8):

```
pnpm dev     # watch + live preview at http://localhost:5078 + push to the engine editor
```

por:

```
pnpm dev        # watch + live web preview at http://localhost:5078
pnpm dev:unity  # same, plus push each save to the Unity editor's dev mode
```

Reemplazar (línea 15):

```
- **Unity:** install the zabloo SDK package, enable **Zabloo → Dev Mode** in the editor, and every save hot-swaps the running view (even in Play mode). For a manual import, copy `dist/zabloo.ir.json` into your project and assign it to a `ZablooDocument`.
```

por:

```
- **Unity:** install the zabloo SDK package, enable **Zabloo → Dev Mode** in the editor, and run `pnpm dev:unity` — every save hot-swaps the running view (even in Play mode). For a manual import, copy `dist/zabloo.ir.json` into your project and assign it to a `ZablooDocument`.
```

- [ ] **Step 4: `README.md` (raíz de `ui`) — bullet del dev loop**

Reemplazar (líneas 56-58):

```
- **Dev loop**: save a `.tsx` → `zabloo dev` re-exports and hot-pushes to the Unity
  editor *and* a live browser preview — through the same loading path as production
  hot-update.
```

por:

```
- **Dev loop**: save a `.tsx` → `zabloo dev` re-exports into a live browser preview;
  add `--unity` to also hot-push each save to the Unity editor — through the same
  loading path as production hot-update.
```

- [ ] **Step 5: Verificación rápida del scaffolder**

Run: `pnpm --filter create-zabloo-app typecheck && pnpm --filter create-zabloo-app test`
Expected: sin errores (el paquete no tiene tests; `--passWithNoTests`).

- [ ] **Step 6: Commit**

```bash
git add examples/hello-button/package.json packages/create-zabloo-app/src/index.ts packages/create-zabloo-app/templates/default/README.md README.md
git commit -m "Adopt web-first dev scripts: dev (web) + dev:unity (engine push)"
```

---

### Task 3: Verificación manual, decision log y push

**Files:**
- Modify: `docs/internal/decisions-architecture.md` (nueva entrada al final)
- Modify: `docs/internal/roadmap.md` (punto 6 del dev loop)

**Interfaces:**
- Consumes: los cambios de Tasks 1-2 ya committeados en `ui`.

- [ ] **Step 1: Verificación manual — web solo (sin warnings)**

Desde `examples/hello-button`: `pnpm dev` en background, esperar ~5s, comprobar la salida y matar el proceso.

Expected: banner con `web preview → http://localhost:5078` y la línea `tip: zabloo dev --unity …`; NINGUNA línea "engine push" ni warning "not reachable". El preview responde: `curl -s -o /dev/null -w "%{http_code}" http://localhost:5078` → `200`.

- [ ] **Step 2: Verificación manual — `--unity` sin editor abierto**

Desde `examples/hello-button`: `pnpm dev:unity` en background, esperar ~5s, comprobar salida y matar el proceso.

Expected: banner con `engine push → http://127.0.0.1:5077/zabloo/envelope` y el warning "engine dev mode is not reachable" (comportamiento actual preservado). La verificación con el editor Unity abierto (hot-swap) queda para el usuario — anotarlo al reportar.

- [ ] **Step 3: Decision log en `docs/internal/`**

Añadir al final de `decisions-architecture.md`:

```markdown
## 2026-08-10 — Dev loop web-first: el push a Unity pasa a ser opt-in (`--unity`)
**Decision:** `zabloo dev` levanta por defecto SOLO el preview web; el push al dev
mode del editor Unity requiere el flag booleano `--unity` (scripts de proyecto:
`dev` = web, `dev:unity` = web + push). Modelo React Native / Ionic (`run-ios` /
`run-android`): un flag por motor, combinables cuando lleguen Godot/Unreal, cada
uno con su puerto por defecto. `--unity` solo habilita el push al editor que el
usuario ya tiene abierto — nunca lanza Unity. Amends 2026-08-03 (dev loop), donde
el push se intentaba siempre.
**Reason:** trabajando solo en web (el caso común desde que existe el preview),
el push incondicional imprimía un warning por guardado — ruido sin valor. El
default debe ser el target sin fricción (web); los motores son una elección
explícita.
**Alternatives considered:** `--engine <nombre>` (más largo para el caso común,
menos idiomático); targets en `zabloo.config.ts` (esconde comportamiento en
config); auto-detect silencioso (menos explícito, y el silencio oculta un editor
mal configurado cuando SÍ quieres Unity); lanzar el editor vía Unity Hub CLI
(frágil, lento, fuera de alcance).
```

En `roadmap.md`, punto 6 (dev loop), añadir al final del texto existente: `Enmienda 2026-08-10: web-first — el push a Unity es opt-in (\`--unity\` / \`pnpm dev:unity\`); ver decisions-architecture.md (2026-08-10).`

- [ ] **Step 4: Commit y push de ambos repos**

```bash
cd docs/internal
git add decisions-architecture.md roadmap.md
git commit -m "Decision: dev loop web-first, push a Unity opt-in via --unity"
git push
cd <repo>
git push
```

Expected: ambos pushes OK (los repos estaban sincronizados con origin al empezar).
