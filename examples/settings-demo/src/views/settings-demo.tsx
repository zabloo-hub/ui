// View "settings-demo" (file-based convention: the filename is the view ID).
// Manual test bed for ZAB-23: Checkbox/Switch (independent booleans) and
// RadioGroup (one value, exclusive selection). Every control is bound, so the
// preview's data panel shows both directions: type a value and the control
// moves; tap the control and the field updates (the game's onDataChanged).
import { Checkbox, Column, Container, Radio, RadioGroup, Switch, Text } from "@zabloo/react";

const LABEL = { color: "{color.text}", fontSize: 16 } as const;
const ROW = { padding: "{space.2}", width: 320 } as const;

export default function SettingsDemo() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: 16 }}>
      <Text style={{ color: "{color.text}", fontSize: 20 }}>Ajustes</Text>

      <Column
        layout={{ padding: "{space.4}", gap: "{space.2}", align: "stretch" }}
        style={{
          background: "{color.panel}",
          radius: "{radius.md}",
          borderWidth: 1,
          borderColor: "{color.border}",
        }}
      >
        <Checkbox
          id="subtitles"
          variant="row"
          autofocus
          checked={{ bind: "settings.subtitles" }}
          onChange="subtitles-changed"
          layout={ROW}
        >
          <Text style={LABEL}>Subtítulos</Text>
        </Checkbox>

        <Switch
          id="sfx"
          variant="row"
          checked={{ bind: "settings.sfx" }}
          onChange="sfx-changed"
          checkedTrack={{ background: "{color.on}" }}
          layout={ROW}
        >
          <Text style={LABEL}>Efectos de sonido</Text>
        </Switch>

        <Text style={{ color: "{color.muted}", fontSize: 14 }}>Calidad gráfica</Text>
        <RadioGroup value={{ bind: "settings.quality" }} layout={{ gap: 4 }}>
          <Radio value="low" variant="row" layout={ROW}>
            <Text style={LABEL}>Baja</Text>
          </Radio>
          <Radio value="medium" variant="row" layout={ROW}>
            <Text style={LABEL}>Media</Text>
          </Radio>
          <Radio value="high" variant="row" layout={ROW}>
            <Text style={LABEL}>Alta</Text>
          </Radio>
        </RadioGroup>
      </Column>

      <Container layout={{ direction: "row", gap: 6 }}>
        <Text style={{ color: "{color.muted}", fontSize: 14 }}>Calidad seleccionada:</Text>
        <Text bind="settings.quality" style={{ color: "{color.text}", fontSize: 14 }} />
      </Container>
    </Column>
  );
}
