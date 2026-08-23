# Spec: `zabloo dev` web-first, `--unity` opt-in (2026-08-10)

## Contexto y problema

Hoy `zabloo dev` hace siempre dos cosas: levanta el preview web (`localhost:5078`) e
intenta un POST a `localhost:5077` (dev mode del editor Unity) en cada guardado. No
lanza Unity — solo le habla si está abierto — pero cuando trabajas solo en web, cada
guardado imprime un warning ("engine dev mode is not reachable"). Ruido sin valor.

**Decisión (aprobada):** modelo React Native / Ionic — el target web es el default de
serie; los motores son opt-in explícito por flag booleano (`--unity`; en el futuro
`--godot`, `--unreal`, combinables, cada uno con su puerto por defecto).

Alternativas descartadas: `--engine <nombre>` (más largo para el caso común, menos
idiomático que RN), targets en `zabloo.config.ts` (esconde el comportamiento en config),
lanzar el editor Unity vía Unity Hub CLI (frágil y lento; `--unity` solo habilita el
push al editor que el usuario ya tiene abierto).

## Cambios

### 1. CLI — `ui/packages/cli/src/cli.ts`

- El comando `dev` gana `--unity` (booleano): "also push each export to the Unity
  editor's dev mode".
- Sin `--unity`, `--port` se ignora (es el puerto del push a Unity).
- Descripción del comando actualizada: watch + web preview por defecto; `--unity` para
  el push al motor.

### 2. Dev loop — `ui/packages/cli/src/dev.ts`

- `devLoop` recibe el target Unity como opcional (p. ej. `unity: { port } | null`).
- **Sin `--unity`:** ningún POST, cero warnings. El banner de arranque sustituye la
  línea "engine push →" por una pista de descubrimiento:
  `tip: zabloo dev --unity pushes each save to the Unity editor (Zabloo → Dev Mode)`.
- **Con `--unity`:** comportamiento idéntico al actual (push en cada guardado; el
  warning de "not reachable" se mantiene — ahora es legítimo porque se pidió).

### 3. Scaffold y ejemplos

- `create-zabloo-app` (plantilla y `src/index.ts`): el script `dev` queda como está
  (web por defecto) y se añade `"dev:unity": "zabloo dev --unity"` — análogo a
  `run-android` de RN.
- `examples/hello-button/package.json`: mismo par de scripts.
- READMEs (plantilla del scaffold, mensaje de éxito del scaffolder, README público de
  `ui`): reflejar "web de serie, `--unity` para Unity".

### 4. Decision log — `docs/internal/`

- Entrada 2026-08-10 en `decisions-architecture.md` (dev loop web-first, motores
  opt-in por flag; enmienda al comportamiento de 2026-08-03).
- Ajuste en `roadmap.md` donde describe el dev loop.

## Verificación (manual, con `examples/hello-button`)

1. `pnpm dev` → solo web: preview funciona, ningún POST ni warning de Unity.
2. `pnpm dev:unity` con el editor abierto (Dev Mode) → hot-swap sigue funcionando.
3. `pnpm dev:unity` con el editor cerrado → warning presente (comportamiento actual).

## Fuera de alcance

- Lanzar el editor Unity desde el CLI.
- Flag `--no-web` u otros targets nuevos.
- Cambios en el SDK de Unity o en el renderer web (el protocolo de push no cambia).
