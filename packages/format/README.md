# @zabloo/format

> The zabloo IR as code: the format's TypeScript types, and the reader that validates an
> envelope before an SDK trusts it.

Part of [zabloo/ui](https://github.com/zabloo-hub/ui) — build your game's UI once in
React, ship a compact engine-agnostic IR, and let a lightweight SDK draw it inside Unity,
Godot or Unreal.

This package knows nothing about any engine or renderer. It is the node vocabulary, the
envelope shape, the loading policy and the handful of algorithms every target must
reproduce exactly (easing, binding resolution, item identity). `@zabloo/react`,
`@zabloo/renderer-web` and every engine SDK are consumers of what lives here.

## Install

```bash
npm install @zabloo/format
```

## Reading an envelope

The IR is a payload consumed at runtime and hot-updatable, so an SDK routinely meets
content authored by a different version of the tooling. `readEnvelope` never throws: it
repairs what it can and reports everything it found.

```ts
import { readEnvelope } from "@zabloo/format";

const { envelope, diagnostics } = readEnvelope(await fetch(url).then((r) => r.text()));

for (const d of diagnostics) {
  console.warn(`[${d.level}] ${d.code} at ${d.path || "<envelope>"}: ${d.message}`);
}

// `null` means a fatal diagnostic stopped the load; anything else is renderable.
if (envelope !== null) render(envelope);
```

`parseEnvelope` is the throwing form, for build-time code where an invalid envelope is a
bug rather than a payload to survive:

```ts
import { EnvelopeError, parseEnvelope } from "@zabloo/format";

try {
  const envelope = parseEnvelope(JSON.parse(json));
} catch (error) {
  if (error instanceof EnvelopeError) console.error(error.diagnostics);
}
```

`DiagnosticCode` is the stable contract (`"unsupported-version"`, `"unknown-token"`, …);
the prose of `message` is free to improve.

## Types

An envelope is the unit an SDK loads: a version, a flat token dictionary, the views, and
an optional asset manifest.

```ts
import { type Envelope, IR_VERSION } from "@zabloo/format";

const envelope: Envelope = {
  v: IR_VERSION,
  tokens: { "color.primary": "#4f46e5", "space.4": 16 },
  views: {
    "main-menu": {
      type: "Container",
      layout: { justify: "center", align: "center", padding: "{space.4}" },
      children: [{ type: "Text", text: "Hello", style: { color: "{color.primary}" } }],
    },
  },
};
```

`ZNode` is a closed union — one member per node type an SDK implements. `supportsVersion`
answers whether this reader can consume a given `v`.

## Documentation

- [The envelope](https://github.com/zabloo-hub/ui/blob/main/docs/format/envelope.md) — version, tokens, views, assets.
- [Loading](https://github.com/zabloo-hub/ui/blob/main/docs/format/loading.md) — validation policy and what every diagnostic means.
- [Versioning](https://github.com/zabloo-hub/ui/blob/main/docs/format/versioning.md) — what is additive, what breaks, what an older SDK does about it.
- [Component catalog](https://github.com/zabloo-hub/ui/blob/main/docs/components/README.md) — every node type, prop by prop.
- [Full documentation](https://github.com/zabloo-hub/ui/blob/main/docs/README.md)

## License

MIT
