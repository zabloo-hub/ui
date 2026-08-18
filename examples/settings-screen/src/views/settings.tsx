// View "settings" (file-based convention: the filename is the view ID).
// The whole form catalogue — Tabs, Checkbox/Switch, Slider, Select and
// TextInput — composed as ONE real settings screen instead of a test bed per
// control. Each control on its own, with every prop it takes, is the `showcase`
// project next door; this is what a game actually ships.
//
// Every control is bound, so the preview's data panel plays the part of the
// game: type a value there and the screen moves; move the screen and the field
// updates (the game's onDataChanged). Everything here is reachable with the
// keyboard or a gamepad alone — arrows/d-pad to move, Enter/Space/A to
// activate, Escape/B to close the dropdown — and with the mouse.

import {
  Button,
  Checkbox,
  Column,
  Option,
  Row,
  Select,
  Slider,
  Switch,
  Tab,
  Tabs,
  Text,
  TextInput,
} from "@zabloo/react";
import type { ReactNode } from "react";

const FIELD_WIDTH = 340;

const LABEL = { color: "{color.text}", fontSize: 16 } as const;
const VALUE = { color: "{color.text.muted}", fontSize: 14 } as const;
const TAB_LABEL = { color: "{color.text}", fontSize: 18 } as const;

// A toggle takes the whole row: `variant="row"` paints it and the padding is
// what makes the empty half of the line clickable too.
const TOGGLE_ROW = { padding: "{space.2}", width: FIELD_WIDTH } as const;

// The three panels are the same box; only their content differs.
const PANEL = {
  layout: {
    direction: "column",
    padding: "{space.4}",
    gap: "{space.3}",
    align: "stretch",
  },
  style: {
    background: "{color.bg.panel}",
    radius: "{radius.md}",
    borderWidth: 1,
    borderColor: "{color.border}",
  },
} as const;

const QUALITIES = ["Low", "Medium", "High", "Ultra"] as const;

// Long enough that the dropdown scrolls: what makes the list navigable is the
// focus dragging the ScrollView along with it.
const LANGUAGES = [
  "Español",
  "English",
  "Français",
  "Deutsch",
  "Italiano",
  "Português",
  "Polski",
  "Türkçe",
  "Svenska",
  "Suomi",
] as const;

/**
 * One labelled setting: the name on the left, the live value on the right and
 * the control underneath. The value is a bound `<Text>` — the IR has no
 * expressions, so what a screen shows of a setting is the datum itself.
 */
function Field({ label, bind, children }: { label: string; bind: string; children: ReactNode }) {
  return (
    <Column layout={{ gap: "{space.2}", align: "stretch" }}>
      <Row layout={{ justify: "space-between", align: "center", gap: "{space.3}" }}>
        <Text style={LABEL}>{label}</Text>
        <Text bind={bind} style={VALUE} />
      </Row>
      {children}
    </Column>
  );
}

export default function Settings() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: "{space.4}" }}>
      <Text style={{ color: "{color.text}", fontSize: 24 }}>Settings</Text>

      {/* The unselected panels LEAVE the layout (the same InLayout flag Collapse
          uses), so switching tabs re-runs the flexbox pass and the screen
          recenters on the panel now showing. */}
      <Tabs
        id="settings-tabs"
        selected={0}
        layout={{ gap: "{space.3}", align: "center" }}
        bar={{ layout: { gap: "{space.2}" } }}
      >
        <Tab
          id="tab-video"
          variant="tab"
          autofocus
          layout={{ padding: "{space.2}" }}
          label={<Text style={TAB_LABEL}>Video</Text>}
          panel={{ ...PANEL, id: "panel-video" }}
        >
          {/* The closed button shows the VALUE, and the list opens in the overlay
              layer anchored to it: it closes on pick, on Escape and on a click
              outside. With the keyboard, Enter opens it over the option in use. */}
          <Field label="Graphics quality" bind="settings.quality">
            <Select
              id="quality"
              variant="setting"
              value={{ bind: "settings.quality" }}
              onChange="quality-changed"
              width={FIELD_WIDTH}
            >
              {QUALITIES.map((quality) => (
                <Option key={quality} value={quality}>
                  <Text style={LABEL}>{quality}</Text>
                </Option>
              ))}
            </Select>
          </Field>

          <Switch
            id="fullscreen"
            variant="row"
            checked={{ bind: "settings.fullscreen" }}
            onChange="fullscreen-changed"
            checkedTrack={{ background: "{color.accent}" }}
            layout={TOGGLE_ROW}
          >
            <Text style={LABEL}>Fullscreen</Text>
          </Switch>

          {/* Quantized: brightness moves from 0 to 100 in tens, and the arrows
              walk that same grid while the slider holds the focus. */}
          <Field label="Brightness" bind="settings.brightness">
            <Slider
              id="brightness"
              variant="setting"
              value={{ bind: "settings.brightness" }}
              min={0}
              max={100}
              step={10}
              onCommit="brightness-apply"
              length={FIELD_WIDTH}
              fill={{ background: "{color.accent}" }}
            />
          </Field>
        </Tab>

        <Tab
          id="tab-audio"
          variant="tab"
          layout={{ padding: "{space.2}" }}
          label={<Text style={TAB_LABEL}>Audio</Text>}
          panel={{ ...PANEL, id: "panel-audio" }}
        >
          {/* Continuous: `onChange` follows the finger (preview the volume) and
              `onCommit` fires on release (apply the setting for real). */}
          <Field label="Master volume" bind="settings.volume">
            <Slider
              id="volume"
              variant="setting"
              value={{ bind: "settings.volume" }}
              min={0}
              max={100}
              step={5}
              onChange="volume-preview"
              onCommit="volume-apply"
              length={FIELD_WIDTH}
              fill={{ background: "{color.accent}" }}
            />
          </Field>

          <Field label="Music" bind="settings.music">
            <Slider
              id="music"
              variant="setting"
              value={{ bind: "settings.music" }}
              min={0}
              max={100}
              step={5}
              onCommit="music-apply"
              length={FIELD_WIDTH}
              fill={{ background: "{color.accent}" }}
            />
          </Field>

          <Switch
            id="sfx"
            variant="row"
            checked={{ bind: "settings.sfx" }}
            onChange="sfx-changed"
            checkedTrack={{ background: "{color.accent}" }}
            layout={TOGGLE_ROW}
          >
            <Text style={LABEL}>Sound effects</Text>
          </Switch>

          <Checkbox
            id="subtitles"
            variant="row"
            checked={{ bind: "settings.subtitles" }}
            onChange="subtitles-changed"
            layout={TOGGLE_ROW}
          >
            <Text style={LABEL}>Subtitles</Text>
          </Checkbox>
        </Tab>

        <Tab
          id="tab-game"
          variant="tab"
          layout={{ padding: "{space.2}" }}
          label="Game"
          panel={{ ...PANEL, id: "panel-game" }}
        >
          {/* Text: the node IS the box, and the SDK paints the caret, the
              selection and the placeholder inside it. `onSubmit` fires on Enter,
              and ←/→ walk the caret before letting the focus leave the field. */}
          <Field label="Name" bind="profile.name">
            <TextInput
              id="player-name"
              value={{ bind: "profile.name" }}
              placeholder="Your name"
              maxLength={16}
              onSubmit="name-accept"
              width={FIELD_WIDTH}
              style={{ borderWidth: 1, borderColor: "{color.border}" }}
              states={{
                empty: { style: { color: "{color.text.muted}" } },
                focused: { style: { borderColor: "{color.accent}" } },
              }}
            />
          </Field>

          {/* The long list is the one that has to scroll: past `maxHeight` the
              dropdown is a ScrollView, and moving the focus drags it along. */}
          <Field label="Language" bind="settings.language">
            <Select
              id="language"
              variant="setting"
              value={{ bind: "settings.language" }}
              onChange="language-changed"
              width={FIELD_WIDTH}
              maxHeight={180}
            >
              {LANGUAGES.map((language) => (
                <Option key={language} value={language}>
                  <Text style={LABEL}>{language}</Text>
                </Option>
              ))}
            </Select>
          </Field>

          <Checkbox
            id="hints"
            variant="row"
            checked={{ bind: "settings.hints" }}
            onChange="hints-changed"
            layout={TOGGLE_ROW}
          >
            <Text style={LABEL}>On-screen hints</Text>
          </Checkbox>
        </Tab>
      </Tabs>

      <Row layout={{ gap: "{space.3}" }}>
        <Button variant="secondary" onClick="settings-reset" layout={{ padding: "{space.3}" }}>
          <Text style={{ color: "{color.text}", fontSize: 16 }}>Reset</Text>
        </Button>
        <Button variant="primary" onClick="settings-save" layout={{ padding: "{space.3}" }}>
          <Text style={{ color: "{color.on-accent}", fontSize: 16 }}>Save</Text>
        </Button>
      </Row>

      <Text style={VALUE}>Mouse, keyboard or gamepad: arrows to move, Enter to activate</Text>
    </Column>
  );
}
