# Collapse

A collapsible region — the `<details>`/`<summary>` model. It is the node that proved
**runtime relayout**: content entering and leaving the flow while the UI is live, which is
why baked rects were never an option for this format.

```jsonc
{
  "type": "Collapse",
  "id": "audio-section",
  "open": false,
  "children": [
    { "type": "Button", "children": [{ "type": "Text", "text": "Audio" }] },
    { "type": "Text", "text": "Master volume" }
  ]
}
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `open` | `boolean` | `true` | **Initial** state. Not bindable — the runtime state belongs to the SDK. |
| `children` | `ZNode[]` | `[]` | `children[0]` = header; `children[1..]` = collapsible content. |

## Slots

- **`children[0]` is the header.** Always in layout, and **tapping it toggles** the
  region. It is focusable, whatever it is: the header of a `Collapse` joins the focusable
  set the way a `Button` does.
- **`children[1..]` is the content.** It enters and leaves the layout with `display:none`
  semantics — the same single hiding mechanism as `visible`, so closing genuinely removes
  it and the siblings below move up.

## Behavior

**States:** the `Collapse` node itself carries none of its own; its **header** carries
`hover`, `pressed` and `focused`. Its `pressed` comes **only from the keyboard or the pad**:
a header is not one of the types the pointer presses, so a tap toggles the section without
ever lighting the down-state. Both carry `disabled` — declared on the `Collapse`, it reaches
the header, and a disabled header no longer opens or closes the section.

**Open state is the SDK's.** `open` in the IR is where it *starts*. Afterwards it is
runtime state — like a `Button`'s `pressed` — and it survives neither serialization nor a
reload. The game drives it through the host channel: `SetOpen(id, open)`.

**Actions:** none. A toggle is not a named action; if the game needs to hear about it, the
header is a `Button` with an `onClick`.

**Motion:** with a `transition`, a `Collapse` animates its **own height** between closed
and its content's natural height, and clips while it does — so the content is cut by the
box that is closing over it, without the author having to ask for a clip.

**Degradation:** as a `Container` — everything shows, permanently open, and the header is
just another child.

## In an accordion

Inside a [`Container` with `group: "exclusive-open"`](container.md#exclusive-open-normative),
opening one `Collapse` closes its siblings. The behavior is the parent's; the `Collapse`
declares nothing about it, and an SDK that ignores the group leaves independent collapses.

## Authoring

```tsx
<Collapse open={false}>
  <Button onClick="audio-toggled"><Text>Audio</Text></Button>
  <Slider value={{ bind: "settings.volume" }} />
</Collapse>

<Accordion layout={{ gap: 8 }}>
  <Collapse open={false}>…</Collapse>
  <Collapse open={false}>…</Collapse>
</Accordion>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `open` | `boolean` | `true` | Initial open state. |
| `children` | `ReactNode` | absent | First child = header; the rest = content. |
