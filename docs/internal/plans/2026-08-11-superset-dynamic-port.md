# Superset: puerto dinámico + SERVE + teardown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada workspace de Superset del repo `ui` arranque `zabloo dev` en un puerto propio (sin colisiones entre workspaces en paralelo), añadir un script `serve.sh` invocable a demanda, y un `teardown.sh` que libere el puerto al borrar el workspace.

**Architecture:** Un helper de shell puro (`.superset/lib/port-for-workspace.sh`) deriva un puerto determinista del path del worktree (hash `cksum` del `$PWD`, rango 20000–29999). Lo invocan tres scripts independientes entre sí: `run` (automático, en `config.json`), `serve.sh` (manual) y `teardown.sh` (al borrar). Ninguno se llama a otro; todos comparten solo el cálculo del puerto.

**Tech Stack:** Bash (`set -euo pipefail`), `cksum`, `lsof`, pnpm workspaces, Superset CLI 1.20.2.

## Global Constraints

- Fórmula del puerto (exacta, no renegociable): `20000 + ($(printf '%s' "$PWD" | cksum | cut -d' ' -f1) % 10000)`.
- Ningún script hace `run`/`serve.sh` llamarse entre sí — ambos son caminos de arranque independientes que comparten solo el helper de puerto.
- El paquete objetivo del dev server es `hello-button-example` (`examples/hello-button/package.json`, script `dev` = `zabloo dev`).
- `zabloo dev` acepta `--preview-port <n>` vía `pnpm --filter hello-button-example dev -- --preview-port <n>` (confirmado: `packages/cli/src/cli.ts:44-60`).
- Commits: español, imperativo, terminando con:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015K4n7bBgH5VF5YTBA3KN2Q
  ```
- Todos los scripts nuevos llevan permiso de ejecución (`chmod +x`), igual que `.superset/setup.sh`.
- Trabajo directo sobre `main` de `ui` (mismo patrón que el plan anterior de `.superset/`) — sin worktree de aislamiento, es config de bajo riesgo.

---

### Task 1: Helper de puerto — `.superset/lib/port-for-workspace.sh`

**Files:**
- Create: `ui/.superset/lib/port-for-workspace.sh`

**Interfaces:**
- Produces: un script ejecutable sin argumentos que imprime un entero en `[20000, 29999]` a stdout, calculado a partir de `$PWD`. Task 2 y Task 3 lo invocan como `PORT=$(./.superset/lib/port-for-workspace.sh)`.

- [ ] **Step 1: Crear el directorio y el script**

```bash
mkdir -p <repo>/.superset/lib
cat > <repo>/.superset/lib/port-for-workspace.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo $(( 20000 + $(printf '%s' "$PWD" | cksum | cut -d' ' -f1) % 10000 ))
EOF
chmod +x <repo>/.superset/lib/port-for-workspace.sh
```

- [ ] **Step 2: Verificar que es determinista (mismo path → mismo puerto)**

Run:
```bash
cd <repo>
A=$(./.superset/lib/port-for-workspace.sh)
B=$(./.superset/lib/port-for-workspace.sh)
echo "A=$A B=$B"
[ "$A" = "$B" ] && echo "OK: determinista" || echo "FALLO: valores distintos"
```
Expected: `OK: determinista`, y `A` es un número entre 20000 y 29999.

- [ ] **Step 3: Verificar que el rango es correcto**

Run:
```bash
cd <repo>
P=$(./.superset/lib/port-for-workspace.sh)
[ "$P" -ge 20000 ] && [ "$P" -le 29999 ] && echo "OK: en rango ($P)" || echo "FALLO: fuera de rango ($P)"
```
Expected: `OK: en rango (<algún número>)`.

- [ ] **Step 4: Verificar que paths distintos dan (normalmente) puertos distintos**

Run:
```bash
mkdir -p /tmp/port-test-a /tmp/port-test-b
cp <repo>/.superset/lib/port-for-workspace.sh /tmp/port-test-a/
cp <repo>/.superset/lib/port-for-workspace.sh /tmp/port-test-b/
(cd /tmp/port-test-a && ./port-for-workspace.sh)
(cd /tmp/port-test-b && ./port-for-workspace.sh)
rm -rf /tmp/port-test-a /tmp/port-test-b
```
Expected: dos números distintos impresos (no es un requisito estricto — un choque es teóricamente posible con estos dos paths concretos, pero si ocurre, repite el test con otros dos nombres de carpeta antes de darlo por sospechoso).

- [ ] **Step 5: Commit**

```bash
cd <repo>
git add .superset/lib/port-for-workspace.sh
git commit -m "Añade el helper de puerto determinista por workspace (Superset)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015K4n7bBgH5VF5YTBA3KN2Q"
```

---

### Task 2: `serve.sh` a demanda + `run` automático en `config.json`

**Files:**
- Create: `ui/.superset/serve.sh`
- Modify: `ui/.superset/config.json`

**Interfaces:**
- Consumes: `.superset/lib/port-for-workspace.sh` de Task 1 (invocado como `./.superset/lib/port-for-workspace.sh` desde la raíz del worktree).
- Produces: dos caminos de arranque del dev server (automático vía Superset y manual vía `serve.sh`), ambos imprimiendo `Preview: http://localhost:<puerto>` en el puerto derivado del helper.

- [ ] **Step 1: Crear `serve.sh`**

```bash
cat > <repo>/.superset/serve.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm build
PORT=$(./.superset/lib/port-for-workspace.sh)
echo "Preview: http://localhost:$PORT"
exec pnpm --filter hello-button-example dev -- --preview-port "$PORT"
EOF
chmod +x <repo>/.superset/serve.sh
```

- [ ] **Step 2: Actualizar `config.json` para que `run` use el puerto dinámico**

Reemplazar el contenido de `ui/.superset/config.json` por:

```json
{
  "setup": ["./.superset/setup.sh"],
  "run": [
    "pnpm build && PORT=$(./.superset/lib/port-for-workspace.sh) && pnpm --filter hello-button-example dev -- --preview-port $PORT && echo \"Preview: http://localhost:$PORT\""
  ],
  "teardown": ["./.superset/teardown.sh"]
}
```

(La clave `teardown` se añade ya aquí, apuntando al script que crea la
Task 3 — así `config.json` solo se toca una vez.)

- [ ] **Step 3: Verificar `serve.sh` localmente (sin crear un workspace de Superset)**

`zabloo dev` es un proceso largo — lánzalo en background, comprueba que sirve en el puerto esperado, y mátalo.

Run:
```bash
cd <repo>
EXPECTED_PORT=$(./.superset/lib/port-for-workspace.sh)
echo "Puerto esperado: $EXPECTED_PORT"
timeout 30 ./.superset/serve.sh > /tmp/serve-test.log 2>&1 &
SERVE_PID=$!
sleep 12
cat /tmp/serve-test.log
curl -sf "http://localhost:$EXPECTED_PORT" > /dev/null && echo "OK: sirve en $EXPECTED_PORT" || echo "FALLO: no responde en $EXPECTED_PORT"
kill $SERVE_PID 2>/dev/null || true
pkill -f "preview-port $EXPECTED_PORT" 2>/dev/null || true
```
Expected: el log contiene `Preview: http://localhost:<EXPECTED_PORT>` y
`OK: sirve en <EXPECTED_PORT>`. Si `pnpm build` tarda más de lo esperado en
un checkout limpio, sube el `sleep` a 20 y el `timeout` a 40.

- [ ] **Step 4: Commit**

```bash
cd <repo>
git add .superset/serve.sh .superset/config.json
git commit -m "Puerto dinámico en run + script serve.sh a demanda (Superset)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015K4n7bBgH5VF5YTBA3KN2Q"
```

---

### Task 3: `teardown.sh` + verificación end-to-end con workspaces reales de Superset

**Files:**
- Create: `ui/.superset/teardown.sh`

**Interfaces:**
- Consumes: `.superset/lib/port-for-workspace.sh` de Task 1; la clave `"teardown"` ya apunta a este archivo desde Task 2, Step 2.
- Produces: comportamiento verificable end-to-end — `run` automático en puerto propio, dos workspaces en paralelo sin colisión, `teardown` libera el puerto al borrar.

- [ ] **Step 1: Crear `teardown.sh`**

```bash
cat > <repo>/.superset/teardown.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
PORT=$(./.superset/lib/port-for-workspace.sh)
PIDS=$(lsof -ti ":$PORT" || true)
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill
  sleep 1
  PIDS=$(lsof -ti ":$PORT" || true)
  if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill -9
  fi
  echo "✓ Procesos del workspace en el puerto $PORT terminados"
else
  echo "✓ Nada escuchando en el puerto $PORT — nada que limpiar"
fi
EOF
chmod +x <repo>/.superset/teardown.sh
```

- [ ] **Step 2: Verificar `teardown.sh` localmente (idempotencia sin nada escuchando)**

Run: `cd <repo> && ./.superset/teardown.sh`
Expected: `✓ Nada escuchando en el puerto <N> — nada que limpiar` (sin error,
exit code 0).

- [ ] **Step 3: Commit de `teardown.sh`**

```bash
cd <repo>
git add .superset/teardown.sh
git commit -m "Añade teardown.sh: libera el puerto del workspace al borrarlo (Superset)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015K4n7bBgH5VF5YTBA3KN2Q"
git push
```

- [ ] **Step 4: Descubrir el project id de Superset para `ui`**

Run: `superset projects list --json`
Expected: una entrada con `"projectName": "ui"` (o `"name": "ui"` según el
campo) y su `projectId`/`id`. Si no existe (proyecto no registrado en esta
máquina), créalo primero:
`superset projects create --local --name ui --import <repo>`
y usa el `projectId` devuelto.

- [ ] **Step 5: Crear DOS workspaces de prueba en paralelo**

Run:
```bash
superset workspaces create --local --project <PROJECT_ID> --name port-test-a --branch port-test-a
superset workspaces create --local --project <PROJECT_ID> --name port-test-b --branch port-test-b
```
Expected: dos respuestas JSON con `workspace.id` y `terminals[0].terminalId`
distintos cada una. Anota ambos IDs y terminal IDs.

- [ ] **Step 6: Esperar el setup y leer el output de `run` en cada workspace**

Run (para cada workspace, sustituyendo IDs):
```bash
superset terminals read --workspace <WORKSPACE_ID> --terminal <TERMINAL_ID>
```
Si el `run` script no ha terminado de arrancar, espera ~15s y vuelve a leer.
Expected en cada uno: una línea `Preview: http://localhost:<puerto>` — y
**los dos puertos deben ser distintos entre sí** (ese es el objetivo del
cambio). Anota `PORT_A` y `PORT_B`.

- [ ] **Step 7: Confirmar que ambos preview responden a la vez**

Run:
```bash
curl -sf "http://localhost:$PORT_A" > /dev/null && echo "OK: workspace A responde en $PORT_A"
curl -sf "http://localhost:$PORT_B" > /dev/null && echo "OK: workspace B responde en $PORT_B"
```
Expected: ambos `OK` — confirma que las dos instancias corren en paralelo
sin colisión de puerto.

- [ ] **Step 8: Borrar el workspace A y confirmar que teardown liberó su puerto**

Run:
```bash
superset workspaces delete <WORKSPACE_A_ID>
sleep 2
curl -sf "http://localhost:$PORT_A" > /dev/null && echo "FALLO: sigue respondiendo en $PORT_A" || echo "OK: puerto $PORT_A liberado"
```
Expected: `OK: puerto $PORT_A liberado`. Si `workspaces delete` no imprime
el output del terminal de teardown directamente, no hace falta — el
resultado observable (puerto libre) es la prueba.

- [ ] **Step 9: Confirmar que el workspace B sigue vivo (el teardown de A no lo afectó)**

Run: `curl -sf "http://localhost:$PORT_B" > /dev/null && echo "OK: workspace B sigue respondiendo en $PORT_B"`
Expected: `OK: workspace B sigue respondiendo en $PORT_B` — el teardown solo
afecta al puerto de su propio worktree.

- [ ] **Step 10: Borrar el workspace B y limpiar**

Run:
```bash
superset workspaces delete <WORKSPACE_B_ID>
sleep 2
curl -sf "http://localhost:$PORT_B" > /dev/null && echo "FALLO: sigue respondiendo en $PORT_B" || echo "OK: puerto $PORT_B liberado"
git -C <repo> worktree list
```
Expected: `OK: puerto $PORT_B liberado`; `git worktree list` solo muestra el
checkout principal (`[main]`) — ambos worktrees de prueba desaparecieron.

- [ ] **Step 11: Registrar la verificación**

No hay código que cambiar en este paso — es la confirmación final de que
Task 3 (y el spec completo) funciona end-to-end con Superset real. Si algo
falló en los steps 4–10, vuelve a Task 1/2/3 según corresponda, corrige, y
repite la verificación end-to-end antes de continuar.
