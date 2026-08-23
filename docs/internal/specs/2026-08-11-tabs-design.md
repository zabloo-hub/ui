# Spec: `<Tabs>` como azúcar de autoría — `group: "exclusive-select"` (2026-08-11, ZAB-22)

> Tarea Linear: [ZAB-22] — milestone **F4 — Capas y overlays**. Alcance: el segundo
> comportamiento de `group` en la IR, el `<Tabs>` de `@zabloo/react`, su
> implementación en `@zabloo/renderer-web` y el ejemplo `examples/tabs-settings`.
> El SDK de Unity queda fuera (web-first, 2026-08-10): degrada solo, ver matriz.
> Desbloquea [ZAB-28] (pantalla de settings integradora).

## Contexto y problema

Las pestañas son el primer composite en el que el comportamiento cruzado **no** es
"abrir/cerrar" sino "seleccionar": un grupo de botones y un contenido por botón, del
que solo uno está presente. La decisión de composites (2026-08-03 §5) ya fijó el
marco — los composites se aplanan y el comportamiento cruzado se declara con `group`,
no con un tipo nuevo — pero dejó abierto **cómo se ata cada botón a su panel**.

La restricción heredada es dura y viene de la propia decisión de `Collapse`
(2026-08-03): el cableado explícito en la IR (un `Button` con el id del nodo que
controla) está **rechazado** — *"that's logic in the JSON"*. Así que la atadura tiene
que ser **posicional**, como el `children[0] = header` de `Collapse`.

## Decisión: contrato posicional bar + paneles

`group: "exclusive-select"` en el Container que envuelve las pestañas:

```
Container group="exclusive-select" selected=0   ← el <Tabs>
├── Container                                   ← children[0]: la BARRA
│   ├── Button                                  ← tab 0
│   ├── Button                                  ← tab 1
│   └── Button                                  ← tab 2
├── Container                                   ← children[1]: panel del tab 0  (InLayout ✔)
├── Container                                   ← children[2]: panel del tab 1  (InLayout ✘)
└── Container                                   ← children[3]: panel del tab 2  (InLayout ✘)
```

Regla que el SDK aplica de forma genérica:

1. `children[0]` es la barra; **sus hijos de tipo `Button`, en orden**, son las
   pestañas. Los hijos que no son `Button` (un título, un separador) **no cuentan**,
   así que decorar la barra no desplaza los índices.
2. `children[1..n]` son los paneles, uno por botón en el mismo orden.
3. Seleccionar el índice `i` deja **solo** `children[i + 1]` en el layout — el mismo
   flag `InLayout` de `Collapse`/`visible`, una única mecánica de ocultación — y da
   al botón `i` el estado `selected`.
4. Activar un botón de la barra (tap, Enter/gamepad) selecciona su índice. Un botón
   con `onClick` **también** dispara su acción: selección y acciones conviven.

Por qué posicional y no dos contenedores (barra + wrapper de paneles): la forma
elegida **es la de `Collapse`** (`children[0]` es el elemento fijo, el resto es
contenido), un nivel menos de convención, y deja los paneles como hijos directos del
Container del grupo, de modo que `layout`/`gap` del `<Tabs>` los alcanza sin capas
intermedias.

### Estado inicial: `selected?: number` en `ContainerNode`

Contrapartida exacta de `CollapseNode.open`: **el estado inicial viaja en la IR, el
estado en runtime es del SDK**. Default `0`, se clampa al rango, no-enteros se
ignoran (tolerancia hacia delante). Coste aceptado: un campo opcional más en
`Container` que solo significa algo con este `group` — la alternativa (empezar
siempre en la pestaña 0) ahorraba el campo pero dejaba sin expresar "esta pantalla
abre en Audio", que ZAB-28 va a querer.

### Estado `selected` (nuevo `StateName`)

`StateName` pasa a `hover | pressed | disabled | focused | selected`. Sin él la
pestaña activa no se distingue y el componente no funciona *out of the box* (regla
de 2026-08-03: los componentes deben funcionar sin que el juego los cablee). Orden
de merge en el renderer: `base → selected → focused → pressed`.

`selected` es vocabulario **compartido**: `RadioGroup` (ZAB-23, F5) reusa `group` y
querrá exactamente este estado.

## API de autoría (`@zabloo/react`)

```tsx
<Tabs id="settings-tabs" selected={0} bar={{ layout: { gap: 8 } }}>
  <Tab id="tab-video" variant="tab" label="Video" panel={{ style: { … } }}>
    …contenido del panel…
  </Tab>
  <Tab id="tab-audio" variant="tab" label={<Text style={{ … }}>Audio</Text>}>…</Tab>
</Tabs>
```

- `<Tab>` es un **marcador**: nunca se renderiza a sí mismo (lanza si aparece fuera
  de `<Tabs>`). `<Tabs>` lee sus props en tiempo de autoría y emite el par
  botón/panel. Es exactamente el patrón "los composites se definen COMO CÓDIGO".
- Las props propias de `<Tab>` estilan **su botón**; `panel` estila su panel;
  `label` acepta un string (se envuelve en `<Text>`) o un nodo.
- Errores en tiempo de autoría (lanzan al exportar, no generan IR rota): hijos de
  `<Tabs>` que no son `<Tab>`, `<Tabs>` vacío, `selected` fuera de rango.

## Comportamiento en el SDK (`@zabloo/renderer-web`)

- `select.ts` (puro, testeable sin canvas — mismo corte que `scroll.ts`) resuelve la
  forma del grupo y clampa el índice. **Tolerante**: si los recuentos no cuadran usa
  los pares que sí, y avisa una vez por build en vez de romper la vista.
- Una única vía de mutación (`setSelected`), como en `Collapse`: tap, Enter/gamepad y
  API del juego pasan por ella y disparan el relayout.
- `activateButton` unifica las dos vías de activación de un `Button` (puntero y
  Enter/gamepad) que hasta ahora duplicaban el disparo de la acción.
- Canal juego→SDK: `setSelectedTab(id, index)` en el handle, la contrapartida de
  `setOpen` (en Unity será `ZablooView.SetSelectedTab`).
- El foco es **independiente** de la selección: la navegación espacial sigue saliendo
  de los rects vivos (2026-08-04), así que las pestañas son focusables por ser
  `Button` y los paneles fuera del layout no aportan candidatos.

## Degradación (SDK viejo recibe contenido con pestañas por hot-update)

| Contenido nuevo | SDK viejo renderiza | Efecto |
|---|---|---|
| `Container` con `group: "exclusive-select"` | Container normal, `group` ignorado | barra + **todos** los paneles apilados; todo legible, nada desaparece |
| `selected: n` | prop desconocida ignorada | sin estado inicial (no hay selección que aplicar) |
| `states.selected` | estado desconocido ignorado | la pestaña activa no se resalta |

Verificado por accidente durante la implementación: el preview corriendo con el
bundle anterior renderizó exactamente esa degradación (barra + tres paneles), y la
pantalla seguía siendo usable.

## Fuera de alcance

- **SDK de Unity** (`EnforceGroup`/`ApplyOpen` tienen ya el hueco natural): entra con
  el trabajo de Unity de F4/F5. Hasta entonces Unity degrada como la tabla.
- Scroll dentro de un panel (ScrollView ya existe, no hay interacción especial),
  transiciones al cambiar de pestaña (F7) y pestañas cerrables/dinámicas (no hay caso
  de uso; las listas de datos llegan en F6).
