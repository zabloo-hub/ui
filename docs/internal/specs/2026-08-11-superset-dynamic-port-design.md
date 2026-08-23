# Superset: puerto dinámico por workspace + SERVE a demanda + teardown — diseño

> Estado: **aprobado** (2026-08-11). Sigue a
> `2026-08-11-dx-skills-y-superset-design.md` (ya implementado: `.superset/`
> committeado con `setup` + `run` fijo en el puerto 5078). Este spec resuelve
> el problema que quedó abierto: varios workspaces de Superset corriendo
> `zabloo dev` en paralelo chocaban en el mismo puerto.

## Contexto técnico verificado antes de diseñar

- `zabloo dev` (`packages/cli/src/cli.ts:44-60`) **ya acepta** `--preview-port
  <n>` (web, default `5078`) y `--port <n>` (Unity dev-mode push, default
  `5077`) vía commander.js. No hace falta tocar el CLI.
- Superset **no expone** ninguna env var que identifique el workspace ni le
  asigne un puerto — hay que derivarlo nosotros.
- El schema de `.superset/config.json` solo reconoce `setup` / `teardown` /
  `run` (más `cwd`); no existe una cuarta clave "serve". Cada clave son
  comandos que Superset ejecuta dentro del worktree en **create / delete /
  run** respectivamente — confirmado en la skill `superset:setup`.
- El puerto de Unity (5077) queda **fuera de alcance**: es opt-in y apunta a
  un único editor de Unity físico compartido entre workspaces — no tiene
  sentido paralelizarlo.

## Decisiones

1. **Origen del puerto: hash determinista del path del worktree**, no
   búsqueda de puerto libre en runtime ni configuración manual. Mismo
   workspace → mismo puerto siempre (fácil de recordar/bookmarkear); sin
   estado que mantener; el riesgo de colisión es mínimo para el número de
   workspaces en paralelo que maneja un founder en solitario.
2. **Fórmula y rango**: `20000 + (cksum(path) % 10000)` → rango 20000–29999.
   Evita los puertos habituales (3000, 8080…) y los propios 5077/5078 del
   CLI.
3. **Un helper compartido, tres scripts independientes.** El cálculo del
   puerto (la parte con lógica no trivial) vive en un único archivo,
   `.superset/lib/port-for-workspace.sh`, invocado por `run` (en
   `config.json`), `serve.sh` y `teardown.sh`. Ninguno de los tres se llama
   entre sí — `run` y `serve.sh` son caminos de arranque independientes, tal
   como se decidió — pero comparten la fórmula del puerto para no duplicar
   una pieza que sería fácil desincronizar accidentalmente.
4. **`run` (automático, al crear el workspace) usa el puerto dinámico.** Se
   decidió explícitamente que el arranque automático también evite
   colisiones — si se hubiera dejado en el puerto fijo, crear dos workspaces
   a la vez seguiría rompiendo el objetivo del cambio.
5. **`serve.sh` es un script a demanda, independiente de `run`.** Mismo
   comportamiento (build + `zabloo dev --preview-port <puerto>`), pero
   invocable manualmente en cualquier terminal del workspace — útil si el
   proceso automático de `run` murió y quieres relanzar el preview sin
   recrear el workspace entero.
6. **Teardown mata por puerto, no por pidfile.** `teardown.sh` recalcula el
   mismo puerto (mismo path de worktree → mismo resultado) y mata lo que
   esté escuchando ahí. Sin estado adicional que mantener (nada de pidfiles
   que puedan quedar obsoletos); cubre el caso real, que es un único proceso
   persistente (el dev server) por workspace.

## Componentes

### `.superset/lib/port-for-workspace.sh`

Script ejecutable, sin argumentos, imprime un número de puerto a stdout:

```bash
#!/usr/bin/env bash
set -euo pipefail
echo $(( 20000 + $(printf '%s' "$PWD" | cksum | cut -d' ' -f1) % 10000 ))
```

Se invoca desde el worktree correcto (`PWD` = el worktree en el que corre
`run`/`serve.sh`/`teardown.sh`), así que el mismo path produce siempre el
mismo puerto sin necesitar pasarlo como argumento.

### `run` en `.superset/config.json`

```json
{
  "setup": ["./.superset/setup.sh"],
  "run": [
    "pnpm build && PORT=$(./.superset/lib/port-for-workspace.sh) && pnpm --filter hello-button-example dev -- --preview-port $PORT && echo \"Preview: http://localhost:$PORT\""
  ],
  "teardown": ["./.superset/teardown.sh"]
}
```

### `.superset/serve.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm build
PORT=$(./.superset/lib/port-for-workspace.sh)
echo "Preview: http://localhost:$PORT"
exec pnpm --filter hello-button-example dev -- --preview-port "$PORT"
```

`exec` para que `serve.sh` se sustituya por el proceso de `pnpm dev` (mismo
PID, `Ctrl+C` lo mata limpio, sin proceso intermedio colgando).

### `.superset/teardown.sh`

```bash
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
```

Idempotente: si no hay nada en el puerto, no falla (el `|| true` en `lsof`
evita que `set -e` aborte cuando no hay coincidencias).

## Manejo de errores / casos límite

- `lsof` no encuentra nada → mensaje informativo, exit 0 (no es un fallo).
- El proceso no muere con `SIGTERM` en 1s → `SIGKILL` como fallback.
- Colisión de hash entre dos workspaces (dos paths distintos mapeando al
  mismo puerto): posible pero de baja probabilidad con 10000 valores y pocos
  workspaces simultáneos; si ocurre, el segundo `pnpm dev` falla con
  `EADDRINUSE` de forma visible (el CLI ya lo reporta "loudly", según la
  decisión 2026-08-10) — no se añade lógica de reintento/reasignación por
  ahora (YAGNI hasta que se observe en la práctica).

## Verificación

Igual que en el spec anterior: crear un workspace de prueba real con
Superset, confirmar que `run` arranca en un puerto no-5078 y que la URL
impresa responde; confirmar `serve.sh` ejecutado a mano imprime el mismo
puerto; borrar el workspace y confirmar que `teardown.sh` termina el
proceso (puerto liberado, verificable con `lsof`).

## Fuera de alcance

- Puerto dinámico para el push a Unity (`--port`, 5077) — editor único
  compartido, no aplica.
- Persistencia de qué puerto usa cada workspace en algún registro/DB —
  el hash ya es la fuente de verdad, recalculable en cualquier momento.
- Reasignación automática en caso de colisión de hash.
