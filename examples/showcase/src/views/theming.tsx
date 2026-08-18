// View "theming" (file-based convention: the filename is the view ID).
//
// Two mechanisms that look alike and are not:
//
//  - **Tokens** are the one indirection the IR has. `{color.accent}` reaches the
//    envelope as those very characters and the SDK does ONE flat lookup, so a
//    theme can be hot-updated on its own without re-emitting a single node.
//  - **Variants** never reach the IR at all. `<Button variant="primary">` is
//    resolved by @zabloo/react at export time against `src/theme.ts`, and the
//    envelope receives the node with its style and its states already merged.
//    No SDK has ever heard the word "primary" — which is what keeps the founding
//    rule intact: resolved per node, no cascade.
//
// And the third piece, states: transient overrides the SDK merges in a NORMATIVE
// order. Value states first — what the control IS is the baseline — then the
// interaction ones over them:
//
//     base → empty → selected → checked → hover → focused → pressed → disabled
//
// `hover` sits under `focused` so a passing mouse never hides a focus ring, and
// `pressed` wins over those because it lasts exactly as long as the finger is
// down. `disabled` closes the chain: it is the one state that also changes
// BEHAVIOUR (the node leaves the interaction model) and the one that inherits,
// so it has to outrank whatever value the control is holding.

import {
  Button,
  Checkbox,
  Column,
  Container,
  Row,
  Tab,
  Tabs,
  Text,
  TextInput,
} from "@zabloo/react";
import { Screen, Section, Tile } from "../components/Frame";
import { tokens } from "../theme";

const BTN = { padding: "{space.2}", justify: "center", align: "center" } as const;

const COLORS = Object.keys(tokens).filter((name) => name.startsWith("color."));
const SPACES = ["space.1", "space.2", "space.3", "space.4", "space.5"] as const;
const RADII = ["radius.sm", "radius.md", "radius.lg"] as const;

/** The merge order, drawn as the chain it is. */
const MERGE_ORDER = [
  "base",
  "empty",
  "selected",
  "checked",
  "hover",
  "focused",
  "pressed",
  "disabled",
];

function Swatch({ token }: { token: string }) {
  // `align: "stretch"` is what gives the swatch a width: an empty Container
  // measures as its content, which is nothing at all.
  return (
    <Column layout={{ width: 116, gap: "{space.1}", align: "stretch" }}>
      <Container
        layout={{ height: 40 }}
        style={{
          background: `{${token}}`,
          radius: "{radius.sm}",
          borderWidth: 1,
          borderColor: "{color.border}",
        }}
      />
      <Text variant="muted">{token}</Text>
    </Column>
  );
}

export default function ThemingView() {
  return (
    <Screen
      title="Theming"
      hint="Tokens travel in the envelope · variants are resolved away · states merge in one fixed order"
    >
      <Section
        title="Colour tokens"
        note="A flat dictionary in the envelope, not a cascade. Change a value and every node that references it re-paints — no tree to re-emit."
        layout={{ wrap: true, gap: "{space.2}" }}
      >
        {COLORS.map((token) => (
          <Swatch key={token} token={token} />
        ))}
      </Section>

      <Section
        title="Spacing and radius"
        note="Any Dim is tokenizable, which is why gaps, corner radii, motion durations and line heights all live in the same dictionary."
        layout={{ direction: "column", align: "start", gap: "{space.3}" }}
      >
        <Row layout={{ gap: "{space.3}", align: "end" }}>
          {SPACES.map((token) => (
            <Column key={token} layout={{ gap: "{space.1}", align: "start" }}>
              <Container
                layout={{ width: Number(tokens[token as keyof typeof tokens]) * 3, height: 20 }}
                style={{ background: "{color.accent}", radius: "{radius.sm}" }}
              />
              <Text variant="muted">{`${token} = ${tokens[token as keyof typeof tokens]}`}</Text>
            </Column>
          ))}
        </Row>
        <Row layout={{ gap: "{space.3}", align: "end" }}>
          {RADII.map((token) => (
            <Column key={token} layout={{ gap: "{space.1}", align: "start" }}>
              <Container
                layout={{ width: 72, height: 44 }}
                style={{ background: "{color.row.alt}", radius: `{${token}}` }}
              />
              <Text variant="muted">{`${token} = ${tokens[token as keyof typeof tokens]}`}</Text>
            </Column>
          ))}
        </Row>
      </Section>

      <Section
        title="Variants"
        note="The same primitive, five named style sets from the theme. Explicit props always win over the variant — the last one here keeps the variant's states and overrides only its background."
        layout={{ wrap: true, align: "center" }}
      >
        {["primary", "secondary", "quiet", "danger", "chip"].map((variant) => (
          <Button key={variant} variant={variant} layout={BTN} onClick={`variant-${variant}`}>
            <Text variant="label">{variant}</Text>
          </Button>
        ))}
        <Button
          variant="primary"
          layout={BTN}
          style={{ background: "{color.success}" }}
          onClick="variant-overridden"
        >
          <Text style={{ color: "{color.on-accent}", fontSize: "{text.md}" }}>
            primary + explicit background
          </Text>
        </Button>
      </Section>

      <Section
        title="The merge order"
        note="Normative, and the same in every target. Each state contributes only style — a state never changes what a node DOES."
        layout={{ wrap: true, align: "center", gap: "{space.1}" }}
      >
        {MERGE_ORDER.map((state, i) => (
          <Row key={state} layout={{ gap: "{space.1}", align: "center" }}>
            <Container
              layout={{ padding: "{space.2}" }}
              style={{
                background: i === 0 ? "{color.row.alt}" : "{color.row}",
                radius: "{radius.sm}",
              }}
            >
              <Text variant="muted">{state}</Text>
            </Container>
            {i < MERGE_ORDER.length - 1 ? <Text variant="muted">→</Text> : null}
          </Row>
        ))}
      </Section>

      <Section
        title="The states, one control each"
        note="Every state below is declared in src/theme.ts, on the variant the control wears. Point at them, hold them, Tab to them."
        layout={{ direction: "column", align: "stretch", gap: "{space.3}" }}
      >
        <Row layout={{ gap: "{space.3}", align: "center", wrap: true }}>
          <Tile label="hover · pressed · focused — one button carries all three">
            <Button id="state-button" variant="primary" layout={BTN} onClick="state-button">
              <Text style={{ color: "{color.on-accent}", fontSize: "{text.md}" }}>
                Point, hold, or Tab here
              </Text>
            </Button>
          </Tile>
          <Tile label="checked — the row lights up while the toggle is on">
            <Checkbox
              id="state-checked"
              variant="row"
              checked
              layout={{ padding: "{space.2}", width: 220 }}
            >
              <Text variant="label">checked</Text>
            </Checkbox>
          </Tile>
        </Row>

        <Row layout={{ gap: "{space.3}", align: "start", wrap: true }}>
          <Tile label="selected — the chosen button of an exclusive-select group">
            <Tabs
              id="state-tabs"
              selected={1}
              layout={{ gap: "{space.2}", align: "start" }}
              bar={{ layout: { gap: "{space.1}" } }}
            >
              {["One", "Two", "Three"].map((name) => (
                <Tab
                  key={name}
                  id={`state-tab-${name.toLowerCase()}`}
                  variant="tab"
                  layout={{ padding: "{space.2}" }}
                  label={<Text variant="label">{name}</Text>}
                  panel={{ layout: { padding: "{space.2}" } }}
                >
                  <Text variant="muted">{`Panel ${name}`}</Text>
                </Tab>
              ))}
            </Tabs>
          </Tile>
          <Tile label="empty — a placeholder is a STATE, not a second colour">
            <TextInput
              id="state-empty"
              variant="field"
              placeholder="type, and the state is gone"
              width={240}
            />
          </Tile>
        </Row>

        {/* `disabled` is the one state that also changes BEHAVIOUR: the node and
            its subtree leave the interaction model — no focus, no hover, no
            press, no action — so these two are inert on purpose. Try to Tab into
            them: the navigation walks straight past. */}
        <Row layout={{ gap: "{space.3}", align: "center", wrap: true }}>
          <Tile label="disabled — declared on the control itself">
            <Button id="state-disabled" variant="primary" disabled layout={BTN} onClick="never">
              <Text variant="label">Out of stock</Text>
            </Button>
          </Tile>
          <Tile label="disabled — and it KEEPS the value it holds">
            <Checkbox
              id="state-disabled-checked"
              variant="row"
              checked
              disabled
              layout={{ padding: "{space.2}", width: 220 }}
            >
              <Text variant="label">checked · disabled</Text>
            </Checkbox>
          </Tile>
        </Row>
      </Section>

      <Section
        title="Motion is themed the same way"
        note="`theme.transitions` is keyed by primitive, exactly like variants, and a node's own `transition` still wins. With durations tokenized, one edit to motion.* tunes — or stops — the whole project."
        layout={{ align: "center", gap: "{space.3}" }}
      >
        <Button variant="secondary" layout={BTN} onClick="theme-motion">
          <Text variant="label">Button: {"{motion.fast}"} from the theme</Text>
        </Button>
        <Button
          variant="secondary"
          layout={BTN}
          transition={{ duration: 500 }}
          onClick="node-motion"
        >
          <Text variant="label">…and 500 ms declared on the node</Text>
        </Button>
      </Section>
    </Screen>
  );
}
