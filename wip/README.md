# Handoff: zabloo dev preview — tool chrome redesign

## Overview
Redesign of the web preview page served by `zabloo dev`. The page renders the developer's game UI on a WebGL canvas and plays the role of "the game": it pushes data into bindings, logs actions the UI fires, and hot-reloads on save. This design replaces the old bare dark page with a proper tool UI: topbar, stage, floating data-bindings panel, IDE-style bottom console, and a statusbar. **Only the chrome is designed — the canvas content belongs to the developer and is a placeholder (a mock game settings screen).**

## About the Design Files
The files in this bundle are **design references created in HTML** — static mockups showing intended look and behavior, not production code. The task is to **recreate this chrome in the zabloo dev-server web app** using its existing stack (or, if greenfield, React + shadcn/ui + Tailwind is the natural fit, since the design follows shadcn/ui component specs exactly).

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii and component states are final and follow shadcn/ui's zinc theme with an indigo primary. Recreate pixel-perfectly with real shadcn/ui components where mapped below.

## Component library mapping (shadcn/ui)
- View selector, viewport picker → `Select` / `DropdownMenu`
- DPR picker → segmented control (`ToggleGroup`)
- Theme, zen, bindings toggles → `Button` (ghost/outline variants) + `Toggle`
- Console tabs → `Tabs` (pill TabsList style)
- Boolean binding → `Switch`; number/string → `Input`; JSON → collapsible `Card` + code area
- Connection pill, problems count, fps → `Badge`
- Gamepad hint → `Tooltip`
- Floating bindings panel → `Card` (custom drag behavior; not a Dialog — it must not block the canvas)

## Screens (artboards in the design file)
The single design file contains 5 artboards, each 1440×900 except the kit:
- **1a Main state (light)** — the hero: view loaded, bindings populated, actions streaming.
- **1b Error state** — fatal diagnostic, stale canvas veil, stale connection.
- **1c Zen mode** — everything collapsed, full-bleed canvas, floating pill controls.
- **1d Dark theme** — main state in the dark palette.
- **1e UI kit** — every chrome component in all states + light/dark token pairs.

## Layout (main state)
Vertical stack, full viewport:
1. **Topbar** — 44px, panel background, 1px bottom border. Left→right, 8px gap, 12px side padding:
   - Wordmark: 16px rounded (5px) indigo-gradient square + "zabloo" (13px/600) + "dev" (10px mono, muted). The brand is deliberately small — the tool is the protagonist.
   - 1px vertical divider (18px tall).
   - **View selector**: outline trigger, label "View" (11px muted) + current view name (12px/500) + chevron. Menu lists the envelope's views (`layout, typography, controls, lists, overlays, motion, media, theming, navigation`); active item = indigo-soft background; a view with a fatal shows a 6px red dot.
   - **Viewport picker**: outline trigger with monitor icon + preset name + resolution in mono. Menu presets: Fit window · 1080p 1920×1080 · 4K TV 3840×2160 · Ultrawide 2560×1080 · Steam Deck 1280×800 · Switch 1280×720 · Phone portrait 390×844 · Phone landscape 844×390 · Custom (two small W×H number inputs + "Set" primary button in the menu footer).
   - **DPR segmented control**: auto / 1× / 2× / 3× (active segment: muted background, 500 weight).
   - **Bindings toggle**: `{ }` glyph (mono) + "Bindings". Closed = outline; open = indigo-soft bg + indigo border/text. Toggles the floating panel.
   - Right-aligned: **connection pill** (dot + label: Live green / Stale amber / Disconnected red, tinted bg + border, fully rounded), divider, **theme toggle** icon button (sun/moon), **zen mode** icon button (expand corners).
2. **Stage** — fills remaining space. Flat neutral surface (`#f4f4f5` light / `#09090b` dark), no pattern. Content centered:
   - Caption above the canvas, 11px mono muted: `Steam Deck · 1280×800 · @1× · 60%` (preset · resolution · DPR · zoom).
   - Canvas frame: 1px border, 6px radius, soft shadow. When a fixed preset is active the canvas renders at that size scaled down to fit; "Fit window" fills the stage.
3. **Bottom console** — 198px, panel bg, 1px top border. Header row 34px: shadcn pill Tabs (**Actions / Problems / Stats**), right side "Clear" ghost button + collapse chevron. Collapsible.
4. **Statusbar** — 26px, 11px text, muted: connection dot + state, problems summary, envelope filename (mono), right-aligned fps mini-badge (`60 fps · 1.9 ms` mono) and gamepad icon.

## Floating bindings panel
- 296px wide `Card` floating over the stage (default position top-right, 14px from edges), radius 10px, 1px border, large soft shadow (`0 10px 32px rgba(20,20,30,.16)`), z-index above canvas.
- Header: "Data bindings" (12px/600) + "6 paths" count (10.5px muted) + **grip handle** (2×3 dots, cursor:grab) + **× close**.
- **Drag & drop**: dragging the grip (or header) repositions the panel anywhere over the stage; persist position (localStorage). × closes it; the topbar "{ } Bindings" button reopens it (button reflects open state).
- **Typed editors**, one per declared data path. Each field: mono path label (11.5px/500) + small type tag (`number`, `string`, `boolean`, `array(n)`), then control:
  - boolean → Switch (36×20, thumb 16; on = indigo)
  - number → Input with vertical stepper buttons (▲/▼) on the right
  - string → plain Input
  - array/object → collapsible JSON editor: header row (disclosure triangle, path, type tag, "Edit JSON" link) + mono code block (10.5px)
- **Two-way binding feedback**: when the canvas UI writes a value back, the field flashes/holds an indigo-soft highlight (soft bg + indigo border) and shows a small mono chip `← UI`. Demo data: `player.gold=1250`, `player.name="Aria"`, `settings.sfx=true (←UI)`, `settings.music=false`, `settings.volume=80`, `shop.items` (array of 4 `{id, price}` objects).
- **Empty state**: dashed-border card, dashed square icon, "No bindings" (12px/500), "This view declares no data paths." (11px muted).
- Error state: fields disabled (55% opacity), amber footer note "Values held — editor re-enables when the export loads."

## Bottom console tabs
- **Actions** — persistent scrolling log, mono 11.5px/1.9. Line format: timestamp (light muted) + type keyword + payload. Types: `view` (muted) `loaded → controls`; `write` (green `#0e8a5f`) `settings.sfx = true`; `action` (indigo) `buy → shop.items.3 (#3)`. "Clear" empties it.
- **Problems** — validator diagnostics. Row: severity chip (`FATAL` red tint, `WARN` amber tint, 9.5px mono 500) + mono message: `[stable-code] path — reason`, e.g. `[invalid-node] views["hud"].children[2].text — missing`. Warnings were auto-repaired (view still correct). **Fatals mean the canvas is stale**: red count badge on the tab, NOT a blocking overlay (see below).
- **Stats** — live frame cost as label/value pairs (mono): fps (or `idle` — renderer paints on demand), frame ms, draw calls, vertices, atlas count + MB.

## Stale canvas treatment (error state)
- Semi-opaque light veil over the canvas (`rgba(246,246,248,.55)` + desaturation) — last good render stays visible underneath.
- Small dark pill centered at the canvas top: amber dot + "Stale — export failed, showing last good render".
- Connection pill switches to amber "Stale"; statusbar shows `1 fatal` (red, 500) `· 2 warnings`; stats show `idle`.
- Never a big red error overlay.

## Zen mode
- Toggled by the topbar corners icon. Collapses topbar, console, statusbar and bindings panel; canvas goes full-bleed on the stage.
- One floating pill, top-right 14px: translucent panel bg (88% + blur 8px), rounded-full, containing: connection dot, preset + resolution (11px mono muted), divider, exit-zen icon button (corners-inward icon). Esc also exits.

## Theme
Manual light/dark toggle (light default). Persist choice. Full token pairs below; the canvas content is untouched by the chrome theme.

## Interactions & Behavior summary
- View selector switches the rendered view; selection persists per envelope.
- Viewport preset: fixed presets render the canvas at exact resolution scaled to fit (zoom % shown in the caption); Custom applies the typed W×H; Fit window stretches.
- DPR: auto follows devicePixelRatio; 1/2/3 force it. Re-renders canvas.
- Connection: websocket to the dev server. `connected` (Live, green) / `stale` (amber — server reachable but last export failed or out of date) / `disconnected` (red). Reload on save is automatic.
- Console and bindings panel are collapsible; collapsed state persists.
- Gamepad: statusbar icon lights indigo on `gamepadconnected`; tooltip on hover: "d-pad / stick: focus · A: press · B: back · right stick: scroll".
- Hover states: sidebar-less chrome uses muted-bg hovers (`#f4f4f5` light / `#27272a` dark) on ghost buttons and menu items.
- The old console-API hint is removed (moved to docs).

## State Management
- `theme: 'light' | 'dark'`
- `activeView: string`, `views: string[]` (from envelope)
- `viewport: {preset, width, height} | 'fit'`, `dpr: 'auto' | 1 | 2 | 3`, `zoom: number` (derived)
- `connection: 'live' | 'stale' | 'disconnected'`
- `bindings: {path, type, value, lastWriteFrom: 'editor' | 'ui'}[]` — `'ui'` triggers the ←UI highlight (clear after a few seconds or on next edit)
- `actions: {ts, kind: 'view'|'action'|'write', text}[]` (append-only, capped)
- `problems: {severity: 'fatal'|'warn', code, path, reason}[]` — any fatal ⇒ stale veil + badges
- `stats: {fps|idle, frameMs, drawCalls, vertices, atlases, atlasMB}`
- `panelOpen: boolean`, `panelPos: {x,y}`, `consoleOpen`, `zen: boolean` — persisted

## Design Tokens (light / dark)
- bg (chrome): `#fafafa` / `#09090b`
- panel: `#ffffff` / `#18181b`
- stage: `#f4f4f5` / `#09090b`
- border: `#e4e4e7` / `#27272a`
- text: `#09090b` / `#fafafa`
- secondary text: `#3f3f46` / `#d4d4d8`
- muted: `#71717a` / `#a1a1aa`
- accent (primary): `#4f46e5` / `#818cf8`
- accent-soft: `#eef2ff` / `rgba(129,140,248,.12)` (border `.35`)
- ok: `#22a04d` / `#34c778` · warn: `#d99711` / `#fbbf24` · danger: `#dc2626` / `#f87171`
- Fonts: **Geist** (UI: 400/500/600) + **Geist Mono** (paths, values, logs, resolutions)
- Type scale: 10px section labels (600, tracking .09em) · 11px statusbar/captions · 11.5px mono logs/paths · 12px controls · 13px nav/menu
- Radii: 6px inputs/buttons/menu items · 8px menus/TabsList · 10px floating panel · full for pills/badges/switch
- Shadows: shadow-sm `0 1px 2px rgba(0,0,0,.05)` on inputs/triggers · menu `0 6px 20px rgba(20,20,30,.1)` · floating panel `0 10px 32px rgba(20,20,30,.16)`
- Focus ring: 1.5px accent border + `0 0 0 3px #e0e7ff`

## Assets
No external assets. All icons are tiny inline stroke SVGs (monitor, sun, moon, zen corners, chevron, grip dots, gamepad) — replace with lucide-react equivalents (`Monitor, Sun, Moon, Maximize, ChevronDown, GripVertical, Gamepad2`), which is what shadcn/ui pairs with.

## Files
- `Zabloo Dev Preview shadcn.dc.html` — the design (open in a browser; artboards 1a–1e top to bottom).
