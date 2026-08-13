# The envelope

The **envelope** is the unit an SDK loads. It is one JSON object carrying a version, a
token dictionary, one or more views, and — when the UI uses images or fonts — an asset
manifest.

There is exactly one loading path: a file imported by hand in the editor and a hot-update
pushed from the platform are the same versioned payload, read the same way.

```jsonc
{
  "v": 1,
  "tokens": {
    "color.primary": "#4f46e5",
    "space.3": 12,
    "radius.md": 6
  },
  "views": {
    "hud": { "type": "Container", "children": [] }
  },
  "assets": {
    "icons/coin.png": {
      "hash": "9f2c…",
      "mime": "image/png",
      "size": 1204,
      "width": 32,
      "height": 32,
      "data": "iVBORw0KGgo…"
    }
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `v` | `number` | — | The IR **major** version. An SDK refuses a payload whose major it does not implement. |
| `tokens` | `Record<string, string \| number>` | — | Flat design-token dictionary. |
| `views` | `Record<string, ZNode>` | — | Documents (views/scenes) keyed by view id. At least one usable view is required. |
| `assets` | `Record<string, AssetEntry>` | absent | Asset manifest keyed by logical id. Envelopes with no assets omit it. |

## Views

An envelope carries **several views** — a HUD, a shop, a settings screen — and the host
chooses which one to render. Each value is a node tree; the key is the id the host asks
for.

View ids are opaque strings and may contain dots, which is why diagnostics address them in
brackets: `views["shop.main"].children[2]`.

Node `id`s are expected to be unique within a view. They are what the host addresses when
it drives a node through the SDK's API, and what an [anchored overlay](../components/overlay.md#anchoring)
points at. Duplicates load, with a warning, and resolve to the first match.

## Tokens

Styles do not bake values: they reference tokens, and the SDK resolves them per node at
render time. Swapping the dictionary re-themes the whole UI without re-emitting the tree —
which is what makes a theme hot-updatable on its own.

A **token reference** is a string wrapped in braces: `"{color.primary}"`. It is valid
anywhere a `Dim` or a `ColorValue` is accepted, and the dictionary is **flat** — the key
is the whole name including its dots, so a lookup is one hash hit and never a walk:

```jsonc
"tokens": { "color.primary": "#4f46e5", "space.3": 12 }
```

```jsonc
"style":  { "background": "{color.primary}" },
"layout": { "padding": "{space.3}" }
```

There is **no cascade and no inheritance**. Every node carries its own resolved style;
nothing is looked up from a parent.

**A token the dictionary does not define never breaks the frame.** The load pass reports
it once, naming the node and the property (`unknown-token`), and then:

- A **`Dim`** falls back to the property's own default — a missing `{space.3}` gives
  `padding: 0`, and a missing `{size.card}` on a `width` leaves the node auto-sized.
- A **declared `ColorValue`** paints the missing-color magenta. It is a deliberate,
  loud signal: the author asked for a color and named one that does not exist, and a
  silently transparent node would hide the typo instead of showing it. An **absent**
  color is not this case — it simply paints nothing.

Token **values** are strings or numbers, and the property decides how to read one: a
`Dim` takes the number, a `ColorValue` takes the string. A token of the wrong type is
treated exactly like a missing one.

## Assets

Images and fonts travel **inside** the envelope. An entry describes the content and, in
v1, carries the bytes:

| Field | Type | Default | Description |
|---|---|---|---|
| `hash` | `string` | — | Content identity (SHA-256, hex). Deduplicates today; the key for content-addressed caching later. |
| `mime` | `string` | — | e.g. `"image/png"`. The format is generic — which MIME types are accepted is an export concern. |
| `size` | `number` | — | Byte size of the decoded content. |
| `width` | `number` | absent | Pixel width (images). Lets layout reserve space before the bytes are decoded. |
| `height` | `number` | absent | Pixel height (images). |
| `data` | `string` | absent | The content, base64-encoded. |

Nodes reference an entry by its manifest key, prefixed: `"asset:icons/coin.png"`. The
prefix is what makes an asset reference recognizable without knowing the manifest —
`isAssetRef` and `assetIdFromRef` in `@zabloo/format` are the shared readers for it.

`data` is optional in the **schema only**: a v1 export always inlines it. The field exists
so a future delivery path can ship an envelope that names its assets by hash and lets the
SDK resolve the bytes from a cache or a CDN — without a format change. An SDK that finds
no `data` and cannot resolve the bytes paints the node's background and nothing else, the
same as an image still being decoded.

`width`/`height` matter for layout, not for paint: an `Image` takes the source's pixel
size as its intrinsic size, so a manifest that omits them makes the node measure as zero
until it is given an explicit size.

## The node base

Every node in `views` is an object with a `type` and the fields below. Type-specific
fields are documented on each [component page](../components/README.md).

| Prop | Type | Default | Description |
|---|---|---|---|
| `type` | `string` | — | The node's identity. Drives its behavior and its default paint. |
| `id` | `string` | absent | Addressable name within the view. |
| `visible` | `Bindable<boolean>` | `true` | The single hiding mechanism, with `display:none` semantics: a hidden node leaves the layout entirely. |
| `layout` | `Layout` | `{}` | See [Layout](layout.md). |
| `style` | `Style` | `{}` | See [Style](style.md). |
| `states` | `Partial<Record<StateName, { style?: Style }>>` | `{}` | Per-state style overrides. See [Style › States](style.md#states). |
| `transition` | `Transition` | absent | Tweens this node's animatable values when they change. See [Motion](motion.md). |
| `autofocus` | `boolean` | `false` | This node takes the initial focus of its scope. See [Input & focus](input.md). |
| `clip` | `boolean` | `false` | Clips children's paint **and** hit-testing to this node's rect. |

**`visible` is the only way to hide something.** There is no second mechanism — no
`display`, no `hidden`, no opacity trick with layout consequences. Hiding a node removes
it from the layout pass, so its siblings close the gap; showing it again brings it back.
Because it is `Bindable`, the game opens and closes UI by moving a boolean in its own
data.

**`clip` is paint configuration, not runtime state.** A node's effective clipping rect is
the intersection of its own with every ancestor's, and it cuts input as well as pixels: a
child painted outside the rect is not tappable there either. A `ScrollView` always clips
and ignores an explicit `clip: false`.

## Where the tree comes from

`@zabloo/react` emits envelopes: `zabloo export` renders the project's views, collects the
assets they reference, and writes the JSON. Authoring-time concepts — user components,
variants, composites — are resolved during that pass and never appear in the output.

Reading an envelope back (parsing, validating, repairing) is [Loading](loading.md).
