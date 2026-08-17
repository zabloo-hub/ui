# Text

A run of text. A **leaf with an intrinsic size**: it takes no children, and the layout pass
sizes it from the font metrics.

```jsonc
{ "type": "Text", "text": "Buy", "style": { "color": "{color.text}", "fontSize": "{text.md}" } }
{ "type": "Text", "text": { "bind": "player.gold" } }
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `text` | `Bindable<string>` | — | The content, literal or bound. `""` is valid content. |

**An empty `text` is a `Text`, an absent one is not** (normative). `""` is what a label
with nothing to say looks like — a `Select` before a value is chosen, a counter at zero, a
bound path the game has not filled in yet — so the node loads and paints like any other,
and [holds its size](#the-empty-text). The field being **absent** is what makes the node
unloadable: the reader drops it with `invalid-node`, since a `Text` that was never given
content is a tree nobody meant to author.

Everything else about a `Text` is [style](../format/style.md): `color`, `fontSize`,
`textAlign`, `textAlignY`, `lineHeight`, `wrap`, `overflow`, `maxLines`. There are no
`Text`-specific layout props, which is what lets a `variant` theme them and a state
override them like any other visual input.

**States:** `disabled` only, inherited from whatever declared it — which is what lets the
label of a disabled section dim with it. `Text` is not focusable and never hovers, so no
other `states.*` applies.

**Actions:** none.

**Degradation:** an SDK that did not know this type would render an empty `Container` — it
is a leaf, so there is no child content to preserve. `Text` has existed since v1.

## Glyphs

Text is **self-rendered**: the SDK rasterizes glyphs from the project's TTF into its own
atlas and draws them as quads. No engine text element is involved, which is what makes the
same string break and paint identically on every target.

One consequence to know about: `fontSize` **snaps** — it is the atlas key, so it is never
tweened by a [transition](../format/motion.md).

## Text layout (normative)

Break points must be identical on every target, so the algorithm is specified rather than
delegated. An SDK implements exactly this, not "whatever the platform's text engine does".

### 1. Available width

- The view offers its own width to the root; each node passes down what it received minus
  its `padding` on both sides.
- An explicit `layout.width` **replaces** the offer for that subtree.
- A row and a column behave the same: a child is offered the parent's full content width,
  never a share of it — v1 measures no cross-child competition.
- A `ScrollView` offers **nothing** on a scrollable axis, so a horizontal scroller never
  wraps its text.
- No offer, or one `<= 0`, means no wrapping.

### 2. Hard breaks

`\r\n` and `\r` normalize to `\n`, which always breaks. An empty paragraph still produces a
line, so a blank line takes vertical space.

### 3. Word wrap — greedy, first fit

- Break opportunities are runs of **SPACE (U+0020)** and **TAB (U+0009)**. No other
  character breaks: a non-breaking space holds, and so does a hyphen.
- A word is appended to the current line while the total fits; otherwise the line ends and
  the word starts the next one.
- The spaces **at a break are dropped** — they never count toward a line's width. Spaces
  that *start* a line do count, so indentation is preserved.
- Every width includes the font's **kerning** between consecutive glyphs, and a break ends
  the chain: the pair straddling it never applies. That is what keeps a measured line
  exactly as wide as the painted one.

### 4. Long words

A word that does not fit on a line of its own is broken **between glyphs**, at the last one
that fits, with a minimum of one glyph per line.

### 5. Truncation

1. Lines past `maxLines` are dropped.
2. `overflow` then cuts what is still too wide. This applies with `wrap: false` only — a
   wrapped line already fits, and the minimum-one-glyph rule wins over the cut.
3. With `overflow: "ellipsis"`, the last kept line is marked with `…` (U+2026), dropping
   glyphs and trailing spaces until the mark fits.

`maxLines` below `1` is not a cap — it would leave nothing to paint — and is ignored.

### 6. Placement

- Block height = number of lines × `lineHeight`.
- Line `i` sits at `top + i · lineHeight`, and its baseline at
  `+ (lineHeight − fontLineHeight) / 2 + ascent` — half-leading, so extra line spacing is
  split evenly above and below and raising `lineHeight` never pushes a single-line `Text`
  off centre.
- `textAlign` aligns **each line** inside the content box, by its own width.
- `textAlignY` aligns **the block as a whole**.

The text properties all snap like `fontSize`: a re-wrap has no meaningful intermediate
value, so none of them is animatable.

### The empty `Text`

`""` is **one line** — the same rule as the empty paragraph of step 2, applied to the whole
content — so an empty `Text` measures `0 × lineHeight` and **keeps its height**. It is not a
special case in the algorithm; it is what the algorithm already says.

That is the behaviour a layout needs. A row of `gap: 8` around a `<Text>` whose binding goes
blank keeps its slot and its spacing instead of collapsing and shuffling its siblings one
gap to the left, and a label that empties and refills does not make the block around it jump.
The width **is** zero: an empty line paints nothing, so nothing reserves horizontal room.

A node that should disappear entirely when it has nothing to say uses `visible` — that is
the prop for it, and it takes the node out of layout, gap included.

## Authoring

```tsx
<Text>Buy</Text>
<Text bind="player.gold" />
<Text style={{ maxLines: 2, overflow: "ellipsis", textAlign: "center" }}>
  A long description that will be cut after two lines
</Text>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `children` | `string \| number \| Array<string \| number>` | — | Static content. |
| `bind` | `string` | — | Data path. Mutually exclusive with `children`. |

Adjacent string and number children are concatenated at authoring time — a template literal
and an interpolated expression both end up as one `text` in the IR. There is no formatting
and no interpolation *at runtime*: a bound `Text` shows the value as it is, and anything
that needs composing is composed by the game before it calls `SetData`.

`<Text></Text>` emits `text: ""` — a real node with a real slot, per the rule above. Several
components lean on it: `<Select>` before a value is chosen, `<Badge>` with no `count`.
