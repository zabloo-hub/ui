# Image

A textured rectangle. A **content-bearing leaf**, like [`Text`](text.md): its intrinsic
size is the source's pixel size, taken from the envelope's
[asset manifest](../format/envelope.md#assets). It takes no children.

```jsonc
{
  "type": "Image",
  "src": "asset:icons/coin.png",
  "fit": "contain",
  "layout": { "width": 32, "height": 32 },
  "style":  { "color": "{color.gold}", "radius": "{radius.sm}" }
}
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `src` | `AssetRef` | — | `"asset:<id>"` — an entry in the manifest. **Never a binding.** |
| `fit` | `"contain" \| "cover" \| "stretch"` | `"contain"` | How the source fills the layout rect. |

`src` is static by design: an asset reference is collected at export time, when the bytes
are gathered into the envelope. There is nothing for a binding to point at at runtime.

## Fit

Every mode paints **inside** the rect. `cover` crops the source through its UVs rather than
overflowing, so the invariant that makes hit-testing on rects honest holds without any
clipping machinery.

| Mode | Result |
|---|---|
| `"contain"` | The whole image, undistorted, centered — letterboxed. |
| `"cover"` | Fills the rect, undistorted, cropping the overflowing axis evenly. |
| `"stretch"` | Fills the rect exactly, distorting the aspect ratio. |

## Paint

No `Image`-specific style props exist. Everything is the ordinary
[style set](../format/style.md):

- **`style.color` tints** the image, multiplied per channel. Absent = white = the pixels as
  they are. It is the same "color of this node's content" that colors glyphs, so
  `states.*.style.color` tints per state for free.
- **`style.radius` rounds** the painted image, matching the node's own background.
- **`style.background` and `borderWidth` are the placeholder.** An image paints nothing
  until its bytes are decoded, and the layout has already reserved the space from the
  manifest's `width`/`height`.

There is **no `loading` state**: the placeholder is authored, not a runtime state.

## Behavior

**States:** `disabled` only, inherited — an icon greys out with the control it belongs to.
An `Image` is not focusable, so nothing else applies. (Inside a `Button`, the button's states
can tint it — the style is the button's, the image is just its content.)

**Actions:** none.

**Degradation:** as an empty `Container` — it is a leaf, so what survives is its box, its
background and its border. Nothing about the layout moves.

## Authoring

```tsx
<Image src="icons/coin.png" />
<Image src="banners/shop.png" fit="cover" layout={{ width: 320, height: 120 }} style={{ radius: 8 }} />
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `src` | `string` | — | Path relative to the project's `src/assets/` — `"logo.png"`, `"icons/coin.png"`. |
| `fit` | `"contain" \| "cover" \| "stretch"` | `"contain"` | How the source fills the rect. |

`zabloo export` reads the file, inlines it in the manifest and rewrites `src` to its
`asset:<id>` reference. The authoring prop is a path in the project; the IR prop is a
reference into the envelope.
