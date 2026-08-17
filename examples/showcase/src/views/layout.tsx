// View "layout" (file-based convention: the filename is the view ID).
//
// The whole layout subset on one page. Flexbox is OURS — the SDK runs the
// measure/arrange pass itself and no engine's layout system is involved — so
// what you see here is the same arithmetic in Unity, in the browser and in every
// target that ever ships (decision 2026-08-01 #1).
//
// The v1 subset is deliberately small: `direction`, `justify`, `align`, `gap`,
// `padding`, `width`/`height`, `grow` and `wrap`. Everything below is one of
// those eight, plus `clip`, which is paint and not layout — a node that cuts its
// children keeps the exact same size it had.
//
// What is NOT here, because it is not in v1: margin, absolute positioning,
// percentages, `align-content` (wrapped lines stack from the start), aspect
// ratios. A grid is the only one that looks missing, and it is not: a grid is a
// row that wraps, which is the last section on this page.

import { Column, Container, Row, Text } from "@zabloo/react";
import type { ReactNode } from "react";
import { PAGE_WIDTH, Screen, Section, Tile } from "../components/Frame";

const JUSTIFY = ["start", "center", "end", "space-between"] as const;
const WRAP_CELLS = Array.from({ length: 11 }, (_, i) => `cell ${i + 1}`);
const ALIGN = ["start", "center", "end", "stretch"] as const;

/** A coloured block, the unit every demo below is built out of. */
function Box({ label, size = 34, tall }: { label: string; size?: number; tall?: boolean }) {
  return (
    <Container
      layout={{ width: size, height: tall ? 52 : size, justify: "center", align: "center" }}
      style={{ background: "{color.accent}", radius: "{radius.sm}" }}
    >
      <Text style={{ color: "{color.on-accent}", fontSize: "{text.sm}" }}>{label}</Text>
    </Container>
  );
}

/** The frame the boxes are arranged inside — sized, so there is room to move in. */
function Frame({
  children,
  ...layout
}: {
  children: ReactNode;
  direction?: "row" | "column";
  justify?: (typeof JUSTIFY)[number];
  align?: (typeof ALIGN)[number];
  gap?: number;
  padding?: number;
}) {
  return (
    <Container
      layout={{ width: 168, height: 96, gap: 4, padding: 4, ...layout }}
      style={{ background: "{color.row}", radius: "{radius.md}" }}
    >
      {children}
    </Container>
  );
}

export default function LayoutView() {
  return (
    <Screen
      title="Layout"
      hint="The v1 Yoga subset — the SDK computes every rect on this page itself"
    >
      <Section title="direction" note="The main axis. Row and Column are sugar for this one prop.">
        <Tile label='direction: "row"'>
          <Frame direction="row">
            <Box label="1" />
            <Box label="2" />
            <Box label="3" />
          </Frame>
        </Tile>
        <Tile label='direction: "column"'>
          <Frame direction="column">
            <Box label="1" />
            <Box label="2" />
          </Frame>
        </Tile>
      </Section>

      <Section
        title="justify"
        note="Distribution ALONG the main axis. `space-between` is the only spacing mode in v1 — no around, no evenly."
      >
        {JUSTIFY.map((justify) => (
          <Tile key={justify} label={justify}>
            <Frame direction="row" justify={justify}>
              <Box label="1" />
              <Box label="2" />
            </Frame>
          </Tile>
        ))}
      </Section>

      <Section
        title="align"
        note="Placement ACROSS the main axis. `stretch` is the one that resizes the child instead of moving it."
      >
        {ALIGN.map((align) => (
          <Tile key={align} label={align}>
            <Frame direction="row" align={align}>
              <Box label="1" />
              <Box label="2" tall />
            </Frame>
          </Tile>
        ))}
      </Section>

      <Section
        title="gap and padding"
        note="Space between children, and space inside the box. Both are Dims, so writing {space.2} instead of 8 puts every gap in the project under one token."
      >
        <Tile label="gap: 4 · padding: 4">
          <Frame direction="row" gap={4} padding={4}>
            <Box label="1" />
            <Box label="2" />
            <Box label="3" />
          </Frame>
        </Tile>
        <Tile label="gap: 16 · padding: 4">
          <Frame direction="row" gap={16} padding={4}>
            <Box label="1" />
            <Box label="2" />
          </Frame>
        </Tile>
        <Tile label="gap: 4 · padding: 16">
          <Frame direction="row" gap={4} padding={16}>
            <Box label="1" />
            <Box label="2" />
          </Frame>
        </Tile>
      </Section>

      <Section
        title="grow"
        note="Shares the leftover space of the line. It is a ratio, not a size: 1 · 2 · 1 means the middle one takes twice the slack."
        layout={{ direction: "column", align: "stretch" }}
      >
        <Row layout={{ width: 560, gap: 4 }}>
          <Container
            layout={{ grow: 1, height: 34, justify: "center", align: "center" }}
            style={{ background: "{color.accent}", radius: "{radius.sm}" }}
          >
            <Text style={{ color: "{color.on-accent}", fontSize: "{text.sm}" }}>grow: 1</Text>
          </Container>
          <Container
            layout={{ grow: 2, height: 34, justify: "center", align: "center" }}
            style={{ background: "{color.accent.hover}", radius: "{radius.sm}" }}
          >
            <Text style={{ color: "{color.on-accent}", fontSize: "{text.sm}" }}>grow: 2</Text>
          </Container>
          <Container
            layout={{ width: 90, height: 34, justify: "center", align: "center" }}
            style={{ background: "{color.row.alt}", radius: "{radius.sm}" }}
          >
            <Text style={{ color: "{color.text}", fontSize: "{text.sm}" }}>width: 90</Text>
          </Container>
        </Row>
      </Section>

      <Section
        title="wrap"
        note="A grid IS this: a row that breaks into lines when the children stop fitting. Lines stack from the start — Yoga's align-content is out of the subset."
        layout={{ direction: "column", align: "stretch" }}
      >
        <Row
          layout={{ width: 420, wrap: true, gap: "{space.2}", padding: "{space.2}" }}
          style={{ background: "{color.row}", radius: "{radius.md}" }}
        >
          {WRAP_CELLS.map((label) => (
            <Container
              key={label}
              layout={{ width: 72, height: 30, justify: "center", align: "center" }}
              style={{ background: "{color.row.alt}", radius: "{radius.sm}" }}
            >
              <Text style={{ color: "{color.text}", fontSize: "{text.sm}" }}>{label}</Text>
            </Container>
          ))}
        </Row>
        <Text variant="muted">
          Narrow the window and nothing here moves: the wrap is against this row's 420 px, not the
          screen. Media queries are not a v1 concept — the game sizes the view.
        </Text>
      </Section>

      <Section
        title="clip"
        note="Paint, not layout: the node keeps its size and its children keep theirs — what changes is that nothing shows (or takes a tap) past the rect."
      >
        <Tile label="clip: true">
          <Container
            clip
            layout={{ width: 200, height: 60, align: "stretch" }}
            style={{ background: "{color.row}", radius: "{radius.md}" }}
          >
            <Container
              layout={{ height: 120, padding: "{space.2}" }}
              style={{ background: "{color.accent}" }}
            >
              <Text style={{ color: "{color.on-accent}", fontSize: "{text.sm}" }}>
                120 px tall inside a 60 px box — the bottom half is cut, and the rounded corners cut
                with it
              </Text>
            </Container>
          </Container>
        </Tile>
        <Tile label="no clip (the default)">
          <Container
            layout={{ width: 200, height: 60, align: "stretch" }}
            style={{ background: "{color.row}", radius: "{radius.md}" }}
          >
            <Container
              layout={{ height: 120, padding: "{space.2}" }}
              style={{ background: "{color.row.alt}" }}
            >
              <Text style={{ color: "{color.text}", fontSize: "{text.sm}" }}>
                The same box, spilling over its parent and over whatever is below it
              </Text>
            </Container>
          </Container>
        </Tile>
      </Section>

      <Column layout={{ width: PAGE_WIDTH, padding: "{space.2}" }}>
        <Text variant="muted">
          Every rect above was computed on this device. Nothing was baked at export time — which is
          what lets a Collapse, a hot-update or a resized window re-run the whole pass.
        </Text>
      </Column>
    </Screen>
  );
}
