// View "motion" (file-based convention: the filename is the view ID).
//
// One prop, `transition` — a duration and a curve — and the rule that drives it:
// *a resolved animatable value changed, so tween it*. There is no list of
// triggers, so entering a state, a `SetData` on a bound value and a theme swap
// all animate through the same path (decision 2026-08-11, ZAB-33).
//
// It lives on the node, not in `style`, because `style` is the set of values
// being interpolated and this is HOW they are interpolated. `duration` is a Dim,
// so motion is themeable like colour: `motion.*` at 0 is a reduce-motion theme,
// and it stops every animation on this page without touching a view.
//
// The four curves are closed-form polynomials, not cubic-béziers: a bézier would
// have to be SOLVED per frame, and then parity between targets would depend on
// two solvers agreeing. `easeProgress` in @zabloo/format is the normative
// implementation everyone ports.
//
// Push a value to race the bars:
//
//   zabloo.setData("demo.progress", 0.9)   // and again with 0.1
//   zabloo.setData("player.hp", 0.35)
//   zabloo.setData("inbox.unread", 12)

import {
  Badge,
  Button,
  Collapse,
  Column,
  Container,
  ProgressBar,
  Row,
  Spinner,
  Text,
} from "@zabloo/react";
import { Screen, Section, Tile } from "../components/Frame";

const EASINGS = ["linear", "ease-in", "ease-out", "ease-in-out"] as const;

/** Three bars of different heights, in the order the wave walks them. */
const BEADS = [
  { id: "short", height: 18 },
  { id: "tall", height: 26 },
  { id: "short-again", height: 18 },
];
const BTN = { padding: "{space.2}", justify: "center", align: "center" } as const;

export default function MotionView() {
  return (
    <Screen
      title="Motion"
      hint="Set demo.progress from the console and watch the four curves separate"
    >
      <Section
        title="The four curves, side by side"
        note="Same bound value, same duration, four easings. What is tweened is the VALUE — the fill is sized from it after the tween, so the bar is never a frame behind."
        layout={{ direction: "column", align: "stretch", gap: "{space.2}" }}
      >
        {EASINGS.map((easing) => (
          <Row key={easing} layout={{ gap: "{space.3}", align: "center" }}>
            <Text variant="muted" layout={{ width: 96 }}>
              {easing}
            </Text>
            <ProgressBar
              value={{ bind: "demo.progress" }}
              transition={{ duration: "{motion.slow}", easing }}
              layout={{ width: 520 }}
              size={12}
              style={{ background: "{color.row}", radius: "{radius.sm}" }}
              fill={{ background: "{color.accent}", radius: "{radius.sm}" }}
            />
          </Row>
        ))}
      </Section>

      <Section
        title="ProgressBar"
        note="A fraction of its own track, which is the one thing v1 could not express: layout dims are px and are not bindable, and `grow` is a share of leftovers, not a proportion."
        layout={{ direction: "column", align: "stretch", gap: "{space.2}" }}
      >
        <Row layout={{ gap: "{space.3}", align: "center" }}>
          <Text variant="muted" layout={{ width: 96 }}>
            player.hp
          </Text>
          <ProgressBar
            value={{ bind: "player.hp" }}
            transition={{ duration: "{motion.base}", easing: "ease-out" }}
            layout={{ width: 320 }}
            size={16}
            style={{ background: "{color.row}", radius: "{radius.lg}" }}
            fill={{ background: "{color.success}", radius: "{radius.lg}" }}
          />
          <Text bind="player.hp" variant="muted" />
        </Row>
        <Row layout={{ gap: "{space.3}", align: "center" }}>
          <Text variant="muted" layout={{ width: 96 }}>
            justify: end
          </Text>
          {/* The fill is anchored by `justify`, so a bar that drains backwards is
              the same node with one word changed. */}
          <ProgressBar
            value={{ bind: "player.hp" }}
            transition={{ duration: "{motion.base}" }}
            layout={{ width: 320, justify: "end" }}
            size={16}
            style={{ background: "{color.row}", radius: "{radius.lg}" }}
            fill={{ background: "{color.danger}", radius: "{radius.lg}" }}
          />
          <Text variant="muted">a shield that drains from the right</Text>
        </Row>
        <Text variant="muted">
          A value that is not a finite number reads as 0 — an empty bar, never a full one.
        </Text>
      </Section>

      <Section
        title="Spinner"
        note="It does not spin: v1 has no transform, so an endless loop is a wave of opacity over its beads. It is a primitive because an endless loop is behavior indexed by identity — the same reason a ScrollView's offset is."
        layout={{ align: "center", gap: "{space.5}" }}
      >
        <Tile label="default — 3 beads, 900 ms">
          <Spinner />
        </Tile>
        <Tile label="dots: 5 · size: 10">
          <Spinner dots={5} size={10} dot={{ background: "{color.accent.hover}" }} />
        </Tile>
        <Tile label="period: 400 · min: 0 · linear">
          <Spinner
            dots={4}
            period={400}
            min={0}
            easing="linear"
            dot={{ background: "{color.gold}" }}
          />
        </Tile>
        <Tile label="period: 0 — a reduce-motion theme freezes it">
          <Spinner dots={3} period={0} />
        </Tile>
        <Tile label="your own beads">
          <Spinner period="{motion.loop}">
            {BEADS.map((bead) => (
              <Container
                key={bead.id}
                layout={{ width: 8, height: bead.height }}
                style={{ background: "{color.success}", radius: "{radius.sm}" }}
              />
            ))}
          </Spinner>
        </Tile>
      </Section>

      <Section
        title="Badge"
        note="Not a primitive at all: a pill Container plus a bound Text, which v1 already had. There is no hide-at-zero — that is an expression, and the IR has none; bind `visible` to a flag the game owns instead."
        layout={{ align: "center", gap: "{space.4}" }}
      >
        <Badge count={{ bind: "inbox.unread" }} />
        <Badge count="99+" style={{ background: "{color.danger}" }} />
        <Badge count={3} style={{ background: "{color.success}" }} />
        <Badge>
          <Row layout={{ gap: "{space.1}", align: "center" }}>
            <Text style={{ color: "{color.on-accent}", fontSize: "{text.sm}" }}>NEW</Text>
          </Row>
        </Badge>
      </Section>

      <Section
        title="States move too"
        note="No trigger list means state changes are just another value change: these buttons cross-fade their background, and the focus ring grows from 0 instead of blinking on. Tab to them."
        layout={{ align: "center", gap: "{space.3}" }}
      >
        <Button variant="primary" layout={BTN} transition={{ duration: 400 }} onClick="slow-press">
          <Text style={{ color: "{color.on-accent}", fontSize: "{text.md}" }}>400 ms</Text>
        </Button>
        <Button
          variant="primary"
          layout={BTN}
          transition={{ duration: "{motion.fast}" }}
          onClick="fast-press"
        >
          <Text style={{ color: "{color.on-accent}", fontSize: "{text.md}" }}>
            120 ms (the theme's)
          </Text>
        </Button>
        <Button variant="primary" layout={BTN} transition={{ duration: 0 }} onClick="instant-press">
          <Text style={{ color: "{color.on-accent}", fontSize: "{text.md}" }}>0 — instant</Text>
        </Button>
      </Section>

      <Section
        title="Layout animates, and the page below moves with it"
        note="What is interpolated are the declared INPUTS (width, height, gap, padding), never the computed rects: one layout pass per frame, no measure→animate→re-measure loop, and the same arithmetic in every target."
        layout={{ direction: "column", align: "stretch", gap: "{space.2}" }}
      >
        <Collapse
          id="animated-collapse"
          open={false}
          transition={{ duration: "{motion.base}", easing: "ease-out" }}
          layout={{ padding: "{space.3}", gap: "{space.2}", align: "stretch" }}
          style={{ background: "{color.row}", radius: "{radius.md}" }}
        >
          <Row layout={{ justify: "space-between", align: "center" }}>
            <Text variant="label">A Collapse animating its own height</Text>
            <Text variant="muted">tap</Text>
          </Row>
          <Text variant="body">
            The content enters the layout when the animation starts and leaves when it ends, with
            the box clipped meanwhile — so closed still costs nothing, and everything under it
            slides.
          </Text>
        </Collapse>
        <Column
          layout={{ padding: "{space.3}" }}
          style={{ background: "{color.panel}", radius: "{radius.md}" }}
        >
          <Text variant="muted">
            This panel is what gets pushed around. Nothing overlaps: it is a real relayout.
          </Text>
        </Column>
      </Section>
    </Screen>
  );
}
