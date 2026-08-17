// View "typography" (file-based convention: the filename is the view ID).
//
// Text is the hardest half of a self-renderer, and the one with no engine to
// fall back on: we own the rasterizer (stb_truetype, the same algorithm in every
// target), the metrics, the atlas and the line breaking — so the wrap you see
// here is OUR algorithm, and it produces the same break points in the browser
// and in Unity from the same TTF (decision 2026-08-11, text).
//
// `<Text>` has exactly two props of its own: `children` and `bind`. Everything
// on this page is plain STYLE — `wrap`, `textAlign`, `textAlignY`, `lineHeight`,
// `maxLines`, `overflow` next to `color` and `fontSize` — which is what makes a
// heading a variant, a state override able to re-align a label, and leading
// themeable through a token like every other Dim.

import { Column, Container, Text } from "@zabloo/react";
import type { ReactNode } from "react";
import { Screen, Section, Tile } from "../components/Frame";

const PROSE =
  "A self-rendered UI owns its own line breaking, so the same envelope wraps identically on every target.";
const LONG_WORD = "Supercalifragilisticexpialidocious, and then some ordinary words after it.";

/** A boxed sample: the frame is what makes an alignment or a cut visible. */
function Sample({
  width = 250,
  height,
  children,
}: {
  width?: number;
  height?: number;
  children: ReactNode;
}) {
  // `align: "stretch"` matters here: without it the Text's rect is only as wide
  // as its longest line, and an alignment inside a shrink-wrapped rect has
  // nothing to align against.
  return (
    <Container
      layout={{
        width,
        ...(height !== undefined && { height }),
        padding: "{space.2}",
        align: "stretch",
      }}
      style={{ background: "{color.row}", radius: "{radius.md}" }}
    >
      {children}
    </Container>
  );
}

export default function TypographyView() {
  return (
    <Screen title="Typography" hint="Six style props — and no Text-specific prop among them">
      <Section title="Size and colour" layout={{ align: "center", wrap: true }}>
        <Text style={{ color: "{color.text}", fontSize: "{text.xl}" }}>26 px</Text>
        <Text style={{ color: "{color.text}", fontSize: "{text.lg}" }}>20 px</Text>
        <Text style={{ color: "{color.text}", fontSize: "{text.md}" }}>15 px</Text>
        <Text style={{ color: "{color.muted}", fontSize: "{text.sm}" }}>13 px muted</Text>
        <Text style={{ color: "{color.accent.hover}", fontSize: "{text.md}" }}>accent</Text>
        <Text style={{ color: "{color.gold}", fontSize: "{text.md}" }}>gold</Text>
      </Section>

      <Section
        title="wrap"
        note="On by default: a Text takes the width the flexbox offers and breaks at spaces. Off, it is one line — and the overflow rule decides what happens to the rest."
      >
        <Tile label="wrap: true (default)">
          <Sample>
            <Text style={{ color: "{color.text}", fontSize: "{text.md}" }}>{PROSE}</Text>
          </Sample>
        </Tile>
        <Tile label="wrap: false">
          <Sample>
            <Text style={{ color: "{color.text}", fontSize: "{text.md}", wrap: false }}>
              {PROSE}
            </Text>
          </Sample>
        </Tile>
        <Tile label="a word longer than the line">
          <Sample>
            <Text style={{ color: "{color.text}", fontSize: "{text.md}" }}>{LONG_WORD}</Text>
          </Sample>
        </Tile>
      </Section>

      <Section
        title="textAlign"
        note="Each line inside the rect. It aligns lines, it does not move the block — that is the flexbox's job."
      >
        {(["start", "center", "end"] as const).map((textAlign) => (
          <Tile key={textAlign} label={`textAlign: "${textAlign}"`}>
            <Sample width={230}>
              <Text style={{ color: "{color.text}", fontSize: "{text.md}", textAlign }}>
                Two lines of text, so the alignment has something to show.
              </Text>
            </Sample>
          </Tile>
        ))}
      </Section>

      <Section
        title="textAlignY"
        note="The whole block inside a rect taller than it. Needs a height — with none, the box is exactly as tall as the text and there is nowhere to sit."
      >
        {(["start", "center", "end"] as const).map((textAlignY) => (
          <Tile key={textAlignY} label={`textAlignY: "${textAlignY}"`}>
            <Sample width={230} height={96}>
              {/* `grow: 1` is what gives the Text a rect taller than its own
                  line — textAlignY places the block INSIDE that rect. */}
              <Text
                layout={{ grow: 1 }}
                style={{ color: "{color.text}", fontSize: "{text.md}", textAlignY }}
              >
                {`Vertically ${textAlignY}`}
              </Text>
            </Sample>
          </Tile>
        ))}
      </Section>

      <Section
        title="lineHeight"
        note="Distance between the tops of two lines. Absent = the font's own metric. The extra space is split above and below each line, so raising it never knocks a single-line label off centre."
      >
        <Tile label="absent (the font's metric)">
          <Sample>
            <Text style={{ color: "{color.text}", fontSize: "{text.md}" }}>{PROSE}</Text>
          </Sample>
        </Tile>
        <Tile label="lineHeight: {text.line} — 22">
          <Sample>
            <Text
              style={{ color: "{color.text}", fontSize: "{text.md}", lineHeight: "{text.line}" }}
            >
              {PROSE}
            </Text>
          </Sample>
        </Tile>
        <Tile label="lineHeight: 30">
          <Sample>
            <Text style={{ color: "{color.text}", fontSize: "{text.md}", lineHeight: 30 }}>
              {PROSE}
            </Text>
          </Sample>
        </Tile>
      </Section>

      <Section
        title="maxLines and overflow"
        note="A cap on the block, and what marks the cut. `clip` (the default) drops the glyphs that would cross the edge — nothing ever paints outside the rect — while `ellipsis` trims the last line until the … fits."
      >
        <Tile label="maxLines: 2 · overflow: clip">
          <Sample>
            <Text style={{ color: "{color.text}", fontSize: "{text.md}", maxLines: 2 }}>
              {PROSE}
            </Text>
          </Sample>
        </Tile>
        <Tile label="maxLines: 2 · overflow: ellipsis">
          <Sample>
            <Text
              style={{
                color: "{color.text}",
                fontSize: "{text.md}",
                maxLines: 2,
                overflow: "ellipsis",
              }}
            >
              {PROSE}
            </Text>
          </Sample>
        </Tile>
        <Tile label="one line, ellipsis — the list-row cut">
          <Sample>
            <Text
              style={{
                color: "{color.text}",
                fontSize: "{text.md}",
                wrap: false,
                overflow: "ellipsis",
              }}
            >
              {PROSE}
            </Text>
          </Sample>
        </Tile>
      </Section>

      <Section
        title="Hard breaks and bound text"
        note="A \n always breaks, wrap or no wrap. A bound Text re-measures and re-lays-out the moment the datum lands: push one from the data panel."
        layout={{ align: "start" }}
      >
        <Tile label="explicit newlines">
          <Sample>
            <Text style={{ color: "{color.text}", fontSize: "{text.md}" }}>
              {"Line one\nLine two\nLine three"}
            </Text>
          </Sample>
        </Tile>
        <Tile label='bind="player.motto"'>
          <Sample>
            <Column layout={{ gap: "{space.1}" }}>
              <Text bind="player.motto" style={{ color: "{color.text}", fontSize: "{text.md}" }} />
              <Text variant="muted">
                Empty until someone sets it — absent data is "", never a crash.
              </Text>
            </Column>
          </Sample>
        </Tile>
      </Section>
    </Screen>
  );
}
