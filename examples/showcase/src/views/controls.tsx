// View "controls" (file-based convention: the filename is the view ID).
//
// Everything the player can operate. Two things are worth watching more than the
// pixels:
//
// 1. **The values come back.** Every control here is bound, and a binding is
//    READ/WRITE (decision 2026-08-11, ZAB-23): the SDK writes the new value into
//    the store and tells the game through one callback, `onDataChanged(path,
//    value)`. The preview plays the game — type into its data panel and the
//    control moves; move the control and the panel updates. There is no
//    `GetChecked(id)`, and there never will be: that would couple the game to
//    the document's ids.
// 2. **Behavior is keyed by node type, never by a prop.** A Toggle is checkable
//    because it is a Toggle, not because a Button carries `checkable` — the rule
//    that has kept the vocabulary at 13 types (decisions ZAB-5, ZAB-23, ZAB-29).
//
// The disclosure section at the bottom is the other half: `group` on a plain
// Container, which is how cross-child behavior (only one open, only one
// selected, only one checked) is declared without inventing a component type.

import {
  Accordion,
  Button,
  Checkbox,
  Collapse,
  Column,
  Option,
  Radio,
  RadioGroup,
  Row,
  Select,
  Slider,
  Switch,
  Tab,
  Tabs,
  Text,
  TextInput,
} from "@zabloo/react";
import { Field, Screen, Section, ValueRow } from "../components/Frame";

const BTN = { padding: "{space.2}", justify: "center", align: "center" } as const;
const CONTROL_WIDTH = 240;
const PANEL = {
  layout: { padding: "{space.3}", gap: "{space.2}", align: "stretch" },
  style: { background: "{color.row}", radius: "{radius.md}" },
} as const;

export default function ControlsView() {
  return (
    <Screen
      title="Controls"
      hint="Every one of them bound — the preview's data panel is standing in for the game"
    >
      <Section
        title="Button"
        note="A press, a focus and a named action. The action is a string; the game subscribes to it."
      >
        <Button variant="primary" layout={BTN} onClick="start-game">
          <Text style={{ color: "{color.on-accent}", fontSize: "{text.md}" }}>Primary</Text>
        </Button>
        <Button variant="secondary" layout={BTN} onClick="open-options">
          <Text variant="label">Secondary</Text>
        </Button>
        <Button variant="quiet" layout={BTN} onClick="show-credits">
          <Text variant="label">Quiet</Text>
        </Button>
        <Button variant="danger" layout={BTN} onClick="delete-save">
          <Text style={{ color: "{color.on-accent}", fontSize: "{text.md}" }}>Danger</Text>
        </Button>
        <Button variant="chip" layout={BTN} onClick="filter-all">
          <Text variant="label">Chip</Text>
        </Button>
      </Section>

      <Section
        title="Checkbox and Switch"
        note="One primitive, `Toggle`, in two looks. The indicator is two positional slots — one painted while on, one while off — so the whole appearance is composition and the SDK needs no drawing of its own."
        layout={{ direction: "column", align: "stretch", gap: "{space.2}" }}
      >
        <Checkbox
          id="subtitles"
          variant="row"
          checked={{ bind: "settings.subtitles" }}
          onChange="subtitles-changed"
          layout={{ padding: "{space.2}", width: 380 }}
        >
          <Text variant="label">Subtitles — checked={"{ bind: 'settings.subtitles' }"}</Text>
        </Checkbox>
        <Switch
          id="fullscreen"
          variant="row"
          checked={{ bind: "settings.fullscreen" }}
          onChange="fullscreen-changed"
          checkedTrack={{ background: "{color.accent}" }}
          layout={{ padding: "{space.2}", width: 380 }}
        >
          <Text variant="label">Fullscreen — the knob moves with LAYOUT, not a transform</Text>
        </Switch>
      </Section>

      <Section
        title="RadioGroup"
        note='A flattened composite: a Container with group "exclusive-check" and ONE value. A radio is checked while its value equals the group’s — the selection is a value, not N booleans.'
        layout={{ direction: "column", align: "stretch", gap: "{space.2}" }}
      >
        <ValueRow label="settings.difficulty" bind="settings.difficulty" />
        <RadioGroup
          value={{ bind: "settings.difficulty" }}
          layout={{ direction: "row", gap: "{space.2}", wrap: true }}
        >
          {["Easy", "Normal", "Hard", "Nightmare"].map((level) => (
            <Radio
              key={level}
              id={`difficulty-${level.toLowerCase()}`}
              variant="row"
              value={level}
              onChange="difficulty-changed"
              layout={{ padding: "{space.2}" }}
            >
              <Text variant="label">{level}</Text>
            </Radio>
          ))}
        </RadioGroup>
      </Section>

      <Section
        title="Select"
        note="Not a primitive either: a Button, an anchored modal Overlay and the same exclusive-check group. Picking closes it, because a selection inside a popover IS the gesture that ends it."
        layout={{ direction: "column", align: "start", gap: "{space.2}" }}
      >
        <Text variant="muted">
          Both are blank until something sets their value: the closed button shows the VALUE itself,
          and the IR has no expressions with which to look a label up from a code.
        </Text>
        <Row layout={{ gap: "{space.3}", align: "end" }}>
          <Field label="A short list">
            <Select
              id="quality"
              variant="setting"
              value={{ bind: "settings.quality" }}
              onChange="quality-changed"
              width={CONTROL_WIDTH}
            >
              {["Low", "Medium", "High", "Ultra"].map((quality) => (
                <Option key={quality} value={quality}>
                  <Text variant="label">{quality}</Text>
                </Option>
              ))}
            </Select>
          </Field>
          <Field label="Longer than its cap — the dropdown scrolls">
            <Select
              id="language"
              variant="setting"
              value={{ bind: "settings.language" }}
              onChange="language-changed"
              width={CONTROL_WIDTH}
              maxHeight={160}
            >
              {[
                "English",
                "Español",
                "Français",
                "Deutsch",
                "Italiano",
                "Português",
                "Polski",
                "Türkçe",
                "Svenska",
                "Suomi",
              ].map((language) => (
                <Option key={language} value={language}>
                  <Text variant="label">{language}</Text>
                </Option>
              ))}
            </Select>
          </Field>
        </Row>
      </Section>

      <Section
        title="TextInput"
        note="The only control with an INTERIOR: a caret and a selection inside content the player is writing. The placeholder is a state (`empty`), not a second colour — so it themes and transitions like any other style."
        layout={{ align: "end" }}
      >
        <Field label="maxLength caps what you TYPE, not what the game sets">
          <TextInput
            id="player-name"
            variant="field"
            value={{ bind: "profile.name" }}
            placeholder="Your name"
            maxLength={16}
            onSubmit="name-accept"
            width={CONTROL_WIDTH}
          />
        </Field>
        <Field label="onChange fires on every keystroke">
          <TextInput
            id="search"
            variant="field"
            value={{ bind: "ui.search" }}
            placeholder="Search…"
            onChange="search-typed"
            width={CONTROL_WIDTH}
          />
        </Field>
        <ValueRow label="profile.name" bind="profile.name" />
      </Section>

      {/* The `disabled` case that matters: half a form switched off from the DATA.
          The prop is on the Column, not on the controls — it inherits down the
          subtree — so the game turns the whole block on and off with one
          `SetData("settings.preset", …)`. Flip it in the preview's data panel and
          watch the labels dim with the controls: `disabled` is the only state a
          Text can be in, and that is exactly why it inherits (ZAB-63).

          The knob and the fill keep their colour on purpose, and it is the rule
          working rather than a gap in it: a state dresses the nodes that DECLARE
          an override, never their descendants (no cascade). Those two are
          positional slots, and the sugar styles a slot with a plain `Style` —
          giving them an off look needs per-slot state styling, which is
          authoring surface this task did not open. */}
      <Section
        title="disabled"
        note="The one state that also changes behaviour: no focus, no hover, no press, no action — for the node AND its subtree. Declared here on the section, bound to the data, so a preset switches off the block it owns. Tab through: the navigation walks past it."
        layout={{ direction: "column", align: "stretch", gap: "{space.2}" }}
      >
        <Column
          {...PANEL}
          disabled={{ bind: "settings.preset" }}
          layout={{ ...PANEL.layout, width: 420 }}
        >
          <Text variant="label">Custom quality</Text>
          <Switch
            id="custom-shadows"
            variant="row"
            checked={{ bind: "settings.shadows" }}
            onChange="shadows"
          >
            <Text variant="label">Shadows</Text>
          </Switch>
          <Field label="Draw distance">
            <Slider
              id="custom-distance"
              variant="setting"
              value={{ bind: "settings.distance" }}
              min={0}
              max={100}
              step={5}
              onCommit="distance-committed"
              length={CONTROL_WIDTH}
            />
          </Field>
          <Field label="Config name">
            <TextInput
              id="custom-name"
              variant="field"
              value={{ bind: "settings.presetName" }}
              placeholder="Unnamed"
              width={CONTROL_WIDTH}
            />
          </Field>
        </Column>
        <ValueRow label="settings.preset" bind="settings.preset" />
      </Section>

      <Section
        title="Slider"
        note="A number set by pointing. `onChange` follows the finger and `onCommit` fires on release — a live preview and the value actually applied are two different questions."
        layout={{ align: "end", gap: "{space.5}" }}
      >
        <Field label="step 5 · onChange + onCommit">
          <Column layout={{ gap: "{space.2}", width: CONTROL_WIDTH, align: "stretch" }}>
            <ValueRow label="Volume" bind="settings.volume" />
            <Slider
              id="volume"
              variant="setting"
              value={{ bind: "settings.volume" }}
              min={0}
              max={100}
              step={5}
              onChange="volume-preview"
              onCommit="volume-apply"
              length={CONTROL_WIDTH}
              fill={{ background: "{color.accent}" }}
            />
          </Column>
        </Field>
        <Field label="continuous — no step at all">
          <Column layout={{ gap: "{space.2}", width: CONTROL_WIDTH, align: "stretch" }}>
            <ValueRow label="Mouse sensitivity" bind="settings.sensitivity" />
            <Slider
              id="sensitivity"
              variant="setting"
              value={{ bind: "settings.sensitivity" }}
              min={0}
              max={1}
              onCommit="sensitivity-apply"
              length={CONTROL_WIDTH}
              fill={{ background: "{color.success}" }}
            />
          </Column>
        </Field>
        {/* Vertical runs bottom-to-top, like a mixing desk fader. Same node, same
            two slots: only the axis changes which one the SDK sizes.

            The wrapping Column is not decoration: `Field` stretches its children,
            and a stretched slider takes its cross size from the column instead of
            from `thickness`. `align: "start"` gives it back its own width. */}
        <Field label='axis="vertical"'>
          <Column layout={{ align: "start" }}>
            <Slider
              id="music"
              variant="setting"
              axis="vertical"
              value={{ bind: "settings.music" }}
              min={0}
              max={100}
              step={10}
              onCommit="music-apply"
              length={120}
              fill={{ background: "{color.accent.hover}" }}
            />
          </Column>
        </Field>
      </Section>

      <Section
        title="Disclosure — the three group behaviors"
        note="Cross-child behavior is declared on a Container, not typed as a component: exclusive-open (Accordion), exclusive-select (Tabs) and exclusive-check (RadioGroup, above). An SDK that does not know a group renders the children as plain siblings."
        layout={{ direction: "column", align: "stretch", gap: "{space.3}" }}
      >
        <Row layout={{ gap: "{space.3}", align: "start" }}>
          <Column layout={{ width: 360, gap: "{space.2}", align: "stretch" }}>
            <Text variant="muted">Collapse — children[0] is the header, the rest is content</Text>
            <Collapse id="lone-collapse" open={false} {...PANEL}>
              <Row layout={{ justify: "space-between", align: "center" }}>
                <Text variant="label">Patch notes</Text>
                <Text variant="muted">tap to toggle</Text>
              </Row>
              <Text variant="body">
                Content entering and leaving the layout is what forced this primitive: the whole
                flexbox pass runs again and everything below shifts.
              </Text>
            </Collapse>
          </Column>

          <Column layout={{ width: 360, gap: "{space.2}", align: "stretch" }}>
            <Text variant="muted">
              Accordion — group "exclusive-open": opening one closes the rest
            </Text>
            <Accordion layout={{ gap: "{space.2}", align: "stretch" }}>
              {["Video", "Audio", "Controls"].map((section, i) => (
                <Collapse
                  key={section}
                  id={`acc-${section.toLowerCase()}`}
                  open={i === 0}
                  {...PANEL}
                >
                  <Text variant="label">{section}</Text>
                  <Text variant="muted">{`Whatever ${section.toLowerCase()} settings live here.`}</Text>
                </Collapse>
              ))}
            </Accordion>
          </Column>
        </Row>

        <Column layout={{ gap: "{space.2}", align: "stretch" }}>
          <Text variant="muted">
            Tabs — group "exclusive-select": children[0] is the bar, children[1..] the panels
          </Text>
          <Tabs
            id="controls-tabs"
            selected={0}
            layout={{ gap: "{space.2}", align: "stretch" }}
            bar={{ layout: { gap: "{space.2}" } }}
          >
            {["Keyboard", "Gamepad", "Touch"].map((name) => (
              <Tab
                key={name}
                id={`tab-${name.toLowerCase()}`}
                variant="tab"
                layout={{ padding: "{space.2}" }}
                label={<Text variant="label">{name}</Text>}
                panel={{ ...PANEL, id: `panel-${name.toLowerCase()}` }}
              >
                <Text variant="body">
                  {`The ${name.toLowerCase()} panel. The unselected ones LEAVE the layout — the same display:none flag a Collapse uses — so switching re-runs the layout pass.`}
                </Text>
              </Tab>
            ))}
          </Tabs>
        </Column>
      </Section>
    </Screen>
  );
}
