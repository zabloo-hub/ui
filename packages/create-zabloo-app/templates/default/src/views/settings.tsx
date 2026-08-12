// A second view — the preview's view picker (top bar) switches between them,
// and in Unity the one a `ZablooDocument` loads is its **View** field.
//
// A settings screen is where the form controls earn their keep: tabs that swap
// panels, a switch, a slider, a dropdown and a text field, all reachable with
// the mouse AND with the keyboard alone (arrows to move, Enter to activate,
// Escape to close the dropdown). Every control is BOUND, so the game reads and
// writes the same paths — `settings.sfx` here is the very one the main menu's
// switch drives, and both views stay in sync because the datum is the state.
import {
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

const FIELD_WIDTH = 280;
const LABEL = { color: "{color.text}", fontSize: 16 } as const;
const VALUE = { color: "{color.muted}", fontSize: 14 } as const;

// The same box for both panels; only the content differs.
const PANEL = {
  layout: { direction: "column", padding: "{space.4}", gap: "{space.3}", align: "stretch" },
  style: {
    background: "{color.surface}",
    radius: "{radius.md}",
    borderWidth: 1,
    borderColor: "{color.border}",
  },
} as const;

export default function Settings() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: "{space.4}" }}>
      <Text style={{ color: "{color.text}", fontSize: 24 }}>Settings</Text>

      {/* The unselected panels LEAVE the layout, so switching tabs re-runs the
          flexbox pass and the screen recenters on the panel now showing. */}
      <Tabs
        id="settings-tabs"
        selected={0}
        layout={{ gap: "{space.3}", align: "center" }}
        bar={{ layout: { gap: "{space.2}" } }}
      >
        <Tab
          id="tab-game"
          variant="tab"
          autofocus
          layout={{ padding: "{space.2}" }}
          label="Game"
          panel={{ ...PANEL, id: "panel-game" }}
        >
          {/* The field IS the box: the SDK paints the caret, the selection and
              the placeholder inside it. `onSubmit` fires on Enter. */}
          <Text style={LABEL}>Player name</Text>
          <TextInput
            id="player-name"
            value={{ bind: "profile.name" }}
            placeholder="Your name"
            maxLength={16}
            onSubmit="name-accept"
            width={FIELD_WIDTH}
            style={{ borderWidth: 1, borderColor: "{color.border}" }}
            states={{
              empty: { style: { color: "{color.muted}" } },
              focused: { style: { borderColor: "{color.primary}" } },
            }}
          />

          {/* The closed button shows the VALUE — the IR has no expressions to
              look a label up with — and the list opens in the overlay layer
              anchored to it, closing on pick, on Escape and on a click outside. */}
          <Text style={LABEL}>Language</Text>
          <Select
            id="language"
            variant="setting"
            value={{ bind: "settings.language" }}
            onChange="language-changed"
            width={FIELD_WIDTH}
          >
            <Option value="en">
              <Text style={LABEL}>English</Text>
            </Option>
            <Option value="es">
              <Text style={LABEL}>Español</Text>
            </Option>
            <Option value="fr">
              <Text style={LABEL}>Français</Text>
            </Option>
          </Select>
        </Tab>

        <Tab
          id="tab-audio"
          variant="tab"
          layout={{ padding: "{space.2}" }}
          label="Audio"
          panel={{ ...PANEL, id: "panel-audio" }}
        >
          {/* `onChange` follows the drag (preview the volume) and `onCommit`
              fires once the player lets go (apply the setting for real). */}
          <Row layout={{ justify: "space-between", align: "center", gap: "{space.3}" }}>
            <Text style={LABEL}>Volume</Text>
            <Text bind="settings.volume" style={VALUE} />
          </Row>
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
            fill={{ background: "{color.primary}" }}
          />

          <Switch
            id="sfx"
            variant="row"
            checked={{ bind: "settings.sfx" }}
            onChange="sfx-changed"
            checkedTrack={{ background: "{color.primary}" }}
            layout={{ padding: "{space.2}", width: FIELD_WIDTH }}
          >
            <Text style={LABEL}>Sound effects</Text>
          </Switch>
        </Tab>
      </Tabs>
    </Column>
  );
}
