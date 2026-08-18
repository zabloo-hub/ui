// View "media" (file-based convention: the filename is the view ID).
//
// `<Image src="banner.png">` is an authoring path relative to `src/assets/`, not
// a runtime lookup: `zabloo export` reads the file, hashes it, inlines it in the
// envelope's asset manifest and rewrites the prop to `asset:banner.png`. So the
// payload is still ONE json — import it by hand, push it down the dev loop or
// hot-update it, and the bytes travel with the tree. The manifest also carries
// the pixel size, which is how layout can reserve the right box before a single
// byte is decoded.
//
// Like `<Text>`, the node has exactly one prop of its own here — `fit` — and
// everything else is ordinary style:
//
//   tint        →  style.color        (the same "colour of the node's content"
//                                      that paints glyphs; the shader already
//                                      multiplies texture × vertex colour)
//   corners     →  style.radius       (it clips the texture, not just the box)
//   placeholder →  style.background   (what shows through while the decode is in
//                                      flight — there is no `loading` state, and
//                                      that is deliberate: a state that never
//                                      fires in one target is content that
//                                      diverges by engine)

import { Column, Container, Image, Row, Text } from "@zabloo/react";
import { Screen, Section, Tile } from "../components/Frame";

/**
 * The box each fit mode is measured against — deliberately nothing like the
 * source's 2:1: `contain` has to letterbox it and `cover` has to crop it.
 */
const BOX = { width: 150, height: 130 } as const;

export default function MediaView() {
  return (
    <Screen title="Media" hint="One prop of its own — the rest is the style every node already had">
      <Section
        title="Intrinsic size"
        note="With no width or height it measures as its own pixels, like a Text measures as its glyphs. The manifest's dimensions are what let the flexbox reserve the space before the decode lands."
        layout={{ align: "center" }}
      >
        <Tile label="banner.png — 240 × 120">
          <Image src="banner.png" />
        </Tile>
        <Tile label="icons/coin.png — 40 × 40">
          <Image src="icons/coin.png" />
        </Tile>
      </Section>

      <Section
        title="fit"
        note="How the source fills a box that is not its shape. `cover` crops through the UVs rather than overflowing, so the invariant holds: nothing paints outside the layout rect, and hit-testing on rects stays honest."
      >
        <Tile label='"contain" — whole picture, letterboxed'>
          <Container
            layout={{ ...BOX, align: "stretch" }}
            style={{ background: "{color.row}", radius: "{radius.md}" }}
          >
            <Image src="banner.png" fit="contain" layout={{ grow: 1 }} />
          </Container>
        </Tile>
        <Tile label='"cover" — fills, crops what spills'>
          <Container
            layout={{ ...BOX, align: "stretch" }}
            style={{ background: "{color.row}", radius: "{radius.md}" }}
          >
            <Image src="banner.png" fit="cover" layout={{ grow: 1 }} />
          </Container>
        </Tile>
        <Tile label='"stretch" — fills, distorts'>
          <Container
            layout={{ ...BOX, align: "stretch" }}
            style={{ background: "{color.row}", radius: "{radius.md}" }}
          >
            <Image src="banner.png" fit="stretch" layout={{ grow: 1 }} />
          </Container>
        </Tile>
      </Section>

      <Section
        title="radius"
        note="It clips the texture itself, clamped to the PAINTED box — with `contain` that box is smaller than the rect, and rounding the rect instead would leave square corners hanging in the letterbox."
      >
        <Tile label="radius: {radius.md}">
          <Image
            src="banner.png"
            fit="cover"
            layout={{ width: 170, height: 96 }}
            style={{ radius: "{radius.md}" }}
          />
        </Tile>
        <Tile label="radius: {radius.lg}">
          <Image
            src="banner.png"
            fit="cover"
            layout={{ width: 170, height: 96 }}
            style={{ radius: "{radius.lg}" }}
          />
        </Tile>
        <Tile label="a round avatar: radius = half the side">
          <Image
            src="banner.png"
            fit="cover"
            layout={{ width: 96, height: 96 }}
            style={{ radius: 48 }}
          />
        </Tile>
      </Section>

      <Section
        title="Tint and opacity"
        note="`style.color` multiplies the texture — a white source takes any tint, which is why icons ship white. Opacity is multiplicative down the subtree, so a dimmed parent dims the icon with it."
        layout={{ align: "center" }}
      >
        <Tile label="no tint">
          <Image src="icons/coin.png" layout={{ width: 48, height: 48 }} />
        </Tile>
        <Tile label="color: {color.gold}">
          <Image
            src="icons/coin.png"
            layout={{ width: 48, height: 48 }}
            style={{ color: "{color.gold}" }}
          />
        </Tile>
        <Tile label="color: {color.accent}">
          <Image
            src="icons/coin.png"
            layout={{ width: 48, height: 48 }}
            style={{ color: "{color.accent}" }}
          />
        </Tile>
        <Tile label="inside a parent at opacity 0.35">
          <Container layout={{ padding: "{space.1}" }} style={{ opacity: 0.35 }}>
            <Image
              src="icons/coin.png"
              layout={{ width: 48, height: 48 }}
              style={{ color: "{color.danger}" }}
            />
          </Container>
        </Tile>
      </Section>

      <Section
        title="The background IS the placeholder"
        note="Nothing paints until the bytes decode, and the box is already the right size — so a surface with the same radius reads as a skeleton. A cross-fade when it lands is a `transition` on opacity, not a new state."
      >
        <Tile label="a card that reserves its image">
          <Column
            layout={{ width: 200, padding: "{space.2}", gap: "{space.2}", align: "stretch" }}
            style={{ background: "{color.panel}", radius: "{radius.md}" }}
          >
            <Image
              src="banner.png"
              fit="cover"
              layout={{ height: 90 }}
              style={{ background: "{color.row.alt}", radius: "{radius.sm}" }}
            />
            <Row layout={{ gap: "{space.2}", align: "center" }}>
              <Image
                src="icons/coin.png"
                layout={{ width: 20, height: 20 }}
                style={{ color: "{color.gold}" }}
              />
              <Text variant="label">1 250</Text>
            </Row>
          </Column>
        </Tile>
        <Tile label="a dangling ref — a warning, and the node paints its own box">
          <Container
            layout={{ width: 200, height: 90, justify: "center", align: "center" }}
            style={{ background: "{color.row}", radius: "{radius.md}" }}
          >
            <Text variant="muted">Missing sources are an authoring error, never a black frame</Text>
          </Container>
        </Tile>
      </Section>
    </Screen>
  );
}
