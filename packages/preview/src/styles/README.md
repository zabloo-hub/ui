# The preview chrome's theme

The design of `zabloo dev`'s preview follows shadcn/ui's **zinc** theme with an
indigo used for selection and active state. It is high fidelity: colours, type,
radii and shadows are final. The artboards have every value inline and no
variables of their own, so **this file is the source of truth** — the tables
below are what `tokens.css` and `globals.css` implement, and what every
component from here on is written against.

Two files:

- **`tokens.css`** — the palette, light and dark, as plain CSS custom
  properties. No Tailwind at-rules, so a browser (and jsdom, and therefore
  `tokens.test.ts`) can read it as-is.
- **`globals.css`** — Tailwind, the fonts, and the mapping from those tokens to
  utilities: shadcn's `--color-*` names, the radius and type scales, the
  shadows, and two utilities of the design's own.

Dark mode is the class `.dark` on `<html>`, applied by the store (V16). Light is
the default and there is **no** `prefers-color-scheme` fallback: the toggle is
manual and the choice is persisted.

## Colours

| token | light | dark | variable | utility |
| -- | -- | -- | -- | -- |
| bg (chrome) | `#fafafa` | `#09090b` | `--background` | `bg-background` |
| panel | `#ffffff` | `#18181b` | `--card`, `--popover` | `bg-card`, `bg-popover` |
| stage | `#f4f4f5` | `#09090b` | `--stage` | `bg-stage` |
| border | `#e4e4e7` | `#27272a` | `--border`, `--input` | `border-border`, `border-input` |
| text | `#09090b` | `#fafafa` | `--foreground` | `text-foreground` |
| secondary text | `#3f3f46` | `#d4d4d8` | `--text-secondary` | `text-subtle` |
| muted | `#71717a` | `#a1a1aa` | `--muted-foreground` | `text-muted-foreground` |
| faint (timestamps, grip) | `#d4d4d8` | `#52525b` | `--text-faint` | `text-faint` |
| hover bg | `#f4f4f5` | `#27272a` | `--muted`, `--accent`, `--secondary` | `bg-muted`, `bg-accent` |
| **primary button** | `#09090b` / fg `#fafafa` | `#fafafa` / fg `#09090b` | `--primary`, `--primary-foreground` | `bg-primary` |
| indigo (selection/active) | `#4f46e5` | `#818cf8` | `--indigo` | `text-indigo`, `bg-indigo` |
| indigo, active text | `#4f46e5` | `#a5b0fc` | `--indigo-foreground` | `text-indigo-foreground` |
| indigo-soft bg | `#eef2ff` | `rgba(129,140,248,.12)` | `--indigo-soft` | `bg-indigo-soft` |
| indigo-soft border | `#c7d2fe` | `rgba(129,140,248,.35)` | `--indigo-soft-border` | `border-indigo-soft-border` |
| indigo chip (`← UI`) | `#e0e7ff` | `rgba(129,140,248,.18)` | `--indigo-chip` | `bg-indigo-chip` |
| focus ring halo | `#e0e7ff` | `rgba(129,140,248,.25)` | `--ring-halo` | via `focus-ring` |
| focus ring border | `#4f46e5` | `#818cf8` | `--ring` (= `--indigo`) | `border-ring` |
| ok dot | `#22a04d` | `#34c778` | `--ok` | `bg-ok` |
| ok pill fg/bg/border | `#3f9152` / `#eaf6ee` / `#cde8d6` | `#6ee7a0` / `rgba(52,199,120,.1)` / `rgba(52,199,120,.28)` | `--ok-fg`, `--ok-bg`, `--ok-border` | `text-ok-fg`, `bg-ok-bg`, `border-ok-border` |
| warn dot | `#d99711` | `#fbbf24` | `--warn` | `bg-warn` |
| warn pill fg/bg/border | `#96690f` / `#fdf5e3` / `#f0dfb2` | `#fbbf24` / `rgba(251,191,36,.1)` / `rgba(251,191,36,.28)` | `--warn-fg`, `--warn-bg`, `--warn-border` | `text-warn-fg`, … |
| warn footer bg | `#fdf9ef` | `rgba(251,191,36,.06)` | `--warn-surface` | `bg-warn-surface` |
| danger dot | `#dc2626` | `#f87171` | `--danger`, `--destructive` | `bg-danger`, `bg-destructive` |
| danger pill fg/bg/border | `#b91c1c` / `#fdecec` / `#f5c9c9` | `#f87171` / `rgba(248,113,113,.1)` / `rgba(248,113,113,.28)` | `--danger-fg`, `--danger-bg`, `--danger-border` | `text-danger-fg`, … |
| log `write` | `#0e8a5f` | `#4cc79a` | `--log-write` | `text-log-write` |
| log `action` | `#4f46e5` | `#a5b0fc` | `--log-action` | `text-log-action` |
| log `view` | = muted | = muted | — | `text-muted-foreground` |
| brand gradient | `135deg, #818cf8 → #4f46e5` | `135deg, #a5b0fc → #6366f1` | `--brand-gradient` | `brand-gradient` |
| switch on | `#4f46e5` | `#6366f1` | `--switch-on` | `bg-switch-on` |
| switch thumb, off | `#ffffff` | `#a1a1aa` | `--switch-thumb-off` | `bg-switch-thumb-off` |
| stale veil | `rgba(246,246,248,.55)` | `rgba(9,9,11,.55)` | `--veil` | `bg-veil` |
| zen pill bg | `rgba(255,255,255,.88)` | `rgba(24,24,27,.88)` | `--glass` | `bg-glass` |

The dark tints for warn and danger are derived with the same recipe the design
uses for ok: the dark dot colour at `.1` for the fill and `.28` for the border.
`--veil` and `--glass` in dark, and `--ring-halo` in dark, are derived the same
way — the artboards only draw them in light.

### Three names that are not a straight copy of the design

- **`--ring` is the indigo, not the halo.** shadcn's primitives spend `--ring` on
  the focus *border* (`focus-visible:border-ring`), so pointing it at the pale
  halo would have given every control a lavender focus border. The halo has its
  own token, `--ring-halo`, and `focus-ring` combines the two.
- **`--text-secondary` / `--text-faint` surface as `subtle` / `faint`.** Their
  own names collide with Tailwind's font-size namespace, and mapping them
  straight across would have spelled `text-text-secondary`.
- **Primary is near-black, not indigo.** That is the zinc theme, and it is
  deliberate: the indigo is for selection and active state only.

## Shadows

The large ones are tinted blue-black (`rgba(20,20,30,…)`) rather than neutral —
that is what keeps a menu from looking dirty over `#fafafa`.

| utility | light | dark |
| -- | -- | -- |
| `shadow-sm` | `0 1px 2px rgba(0,0,0,.05)` | same |
| `shadow-control` (inputs, triggers) | `0 1px 2px rgba(0,0,0,.05)` | **none** |
| `shadow-tab` (the active console tab) | `0 1px 2px rgba(0,0,0,.08)` | `0 1px 2px rgba(0,0,0,.3)` |
| `shadow-menu` | `0 6px 20px rgba(20,20,30,.1)` | same |
| `shadow-panel` (bindings panel) | `0 10px 32px rgba(20,20,30,.16)` | `0 10px 32px rgba(0,0,0,.45)` |
| `shadow-tooltip` | `0 4px 14px rgba(0,0,0,.2)` | same |
| `shadow-frame` (canvas frame) | `0 2px 10px rgba(20,20,30,.08)` | `0 4px 18px rgba(0,0,0,.4)` |
| `shadow-pill` (zen, stale) | `0 2px 8px rgba(0,0,0,.25)` | same |

The four that change with the theme are `@utility` blocks over tokens rather
than `@theme` keys, because Tailwind compiles a `@theme` shadow into the utility
as a literal (it splits the colour out to support `shadow-<color>`), leaving no
variable for `.dark` to move. The call site is the same either way; what changes
is that those four set `box-shadow` outright and so do not stack with `ring-*`.

"none" in dark is written `0 0 #0000`, not `none`: a `none` in the middle of a
composed box-shadow list invalidates the whole declaration, and a fully
transparent shadow is the same pixels.

## Focus ring

`focus-visible:focus-ring` — a `1.5px` indigo border plus a `3px` halo, no
offset. The halo is an `outline` rather than the `0 0 0 3px` box-shadow it was
drawn with: identical geometry, and it does not collide with the
`shadow-control` the same element is already wearing.

It thickens the border on all four sides, so use it on the fully-bordered
controls it is for. On a single-edge element (a `border-b` tab) it would draw
the other three.

## Radii

`--radius` stays at shadcn's `6px` for the components that read it directly. The
scale is mapped onto shadcn's names rather than onto its
`calc(var(--radius) ± 4px)` chain, so the generated primitives land on the drawn
radius with no retouching — Button and Input are `rounded-md`, TabsList is
`rounded-lg`, Card is `rounded-xl`.

| utility | size | where |
| -- | -- | -- |
| `rounded-xs` | 4px | type tags, severity chips, the `← UI` chip |
| `rounded-sm` | 5px | micro controls: `Set`, the W×H inputs, `Clear` on hover |
| `rounded-md` | 6px | inputs, buttons, menu items, canvas frame, tooltip |
| `rounded-lg` | 8px | menus, TabsList, accent-soft rows, JSON card, empty state |
| `rounded-xl` | 10px | the floating bindings panel |
| `rounded-full` | — | pills, badges, the switch, dots |

## Typography

**Geist** for the UI, **Geist Mono** for paths, values, logs and resolutions —
bundled via `@fontsource-variable`, not a CDN, because `zabloo dev` is a local
tool and has to look the same with the network unplugged. `font-sans` /
`font-mono`, or `var(--font-mono)` where a class will not reach.

The chrome's base is **12px**, not Tailwind's 16 or shadcn's 14, and it is set on
`body`. Sizes are named rather than numbered, because they are half-pixel and
`text-[11.5px]` scattered across twenty files is how a scale stops being one.
Tailwind's own `text-xs` / `text-sm` are left meaning 12px and 14px.

| utility | size | where |
| -- | -- | -- |
| `text-micro` | 8px | the number stepper's arrows |
| `text-tag` | 9.5px | type tags, count badge, severity chips, stat labels |
| `text-label` | 10px | section labels (600, tracking `.09em`), "Edit JSON", "dev" |
| `text-code` | 10.5px | mono: log/JSON/filename/fps, "N paths" |
| `text-caption` | 11px | statusbar, captions, resolutions |
| `text-log` | 11.5px / 1.9 | mono: log lines, paths, segmented control, stale pill |
| `text-ui` | 12px | the base: controls, tabs, buttons, panel title |
| `text-item` | 12.5px | view selector items |
| `text-brand` | 13px | the wordmark |
| `text-stat` | 14px | stat values, the `×` close |

## Checking it

`tokens.test.ts` injects `tokens.css` into jsdom and asserts what the key tokens
resolve to with and without `.dark`, that nothing exists in one theme and not the
other, and that `color-scheme` follows. The *visual* check is the kit page
(V17), which puts every component in every state side by side in both themes.

Not defined here, because this chrome uses none of them: shadcn's `--chart-*`
and `--sidebar-*`. `shadcn add` for a component that wants them will need them
added.
