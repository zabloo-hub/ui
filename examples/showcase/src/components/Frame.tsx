// The chrome every view shares. These are USER components: React executes them
// at authoring time and they emit zabloo primitives, so nothing named `Screen`
// or `Section` ever reaches the IR — the envelope only ever sees Containers and
// Texts (decision 2026-07-09). That is also why they can take any props they
// like: they are not a format extension, they are a function.

import { Column, Container, type ContainerProps, Row, ScrollView, Text } from "@zabloo/react";
import type { ReactNode } from "react";

/**
 * Content width every view lines up to, so switching views does not jump. It is
 * a number and not a fraction of the window on purpose: v1 has no percentages
 * and no media queries — the GAME sizes the view, and a UI is authored for the
 * canvas it will be shown on.
 */
export const PAGE_WIDTH = 760;

/**
 * A view's outer frame: the title, the one-line hint under it, and a scrolling
 * body. The body is a `<ScrollView>` on purpose — the showcase is denser than a
 * small window, and a catalog that could not survive its own scrolling would be
 * a poor advert for it.
 */
export function Screen({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <Column layout={{ grow: 1, align: "center", padding: "{space.4}", gap: "{space.3}" }}>
      <Column layout={{ width: PAGE_WIDTH, gap: "{space.1}" }}>
        <Text variant="title">{title}</Text>
        <Text variant="muted">{hint}</Text>
      </Column>

      {/* `height: 0` + `grow: 1` is the idiom for "take exactly what is left".
          There is no flex-shrink in the v1 subset, so a scroller with `grow`
          alone measures its whole content and hugs it — bigger than its parent,
          with nothing to scroll. Zeroing the base makes `grow` its only source
          of size, and then the leftover of the column IS the viewport.

          `id="page"` so the game — here, the preview's console — can drive it:
          `zabloo.setScroll("page", 0, 400)`. The offset itself is runtime state
          the SDK owns; it is never authored and never serialized. */}
      <ScrollView
        id="page"
        layout={{
          width: PAGE_WIDTH,
          height: 0,
          grow: 1,
          gap: "{space.3}",
          padding: "{space.1}",
          align: "stretch",
        }}
      >
        {children}
      </ScrollView>
    </Column>
  );
}

/**
 * A labelled block: what is being shown, one line about why, and the demo. The
 * caption is the part that makes a screenshot readable on its own.
 */
export function Section({
  title,
  note,
  layout,
  children,
}: {
  title: string;
  note?: string;
  /** Extra layout for the demo area — the block itself is always a column. */
  layout?: ContainerProps["layout"];
  children: ReactNode;
}) {
  return (
    <Column variant="panel" layout={{ padding: "{space.3}", gap: "{space.2}", align: "stretch" }}>
      <Text variant="heading">{title}</Text>
      {note === undefined ? null : <Text variant="muted">{note}</Text>}
      {/* `wrap` by default: a row of demos that outgrows the page breaks into a
          second line instead of running off the edge. */}
      <Container
        layout={{ direction: "row", gap: "{space.3}", align: "start", wrap: true, ...layout }}
      >
        {children}
      </Container>
    </Column>
  );
}

/**
 * A demo tile: a small labelled box. The label sits UNDER the box so the boxes
 * themselves line up, which is what makes a row of variants comparable.
 */
export function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Column layout={{ gap: "{space.1}", align: "start" }}>
      {children}
      <Text variant="muted">{label}</Text>
    </Column>
  );
}

/** A caption above a control, so a bare toggle still says what it is. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Column layout={{ gap: "{space.1}", align: "stretch" }}>
      <Text variant="muted">{label}</Text>
      {children}
    </Column>
  );
}

/** Label on the left, live bound value on the right — the shape of a settings row. */
export function ValueRow({ label, bind }: { label: string; bind: string }) {
  return (
    <Row layout={{ justify: "space-between", align: "center", gap: "{space.3}" }}>
      <Text variant="label">{label}</Text>
      <Text bind={bind} variant="accent" />
    </Row>
  );
}
