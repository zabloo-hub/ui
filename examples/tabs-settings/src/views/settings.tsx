// View "settings" (file-based convention: the filename is the view ID).
// Manual test bed for ZAB-22: <Tabs> flattens to Container + Buttons with the
// "exclusive-select" group — the unselected panels leave the layout (the same
// InLayout flag Collapse uses), so switching tabs re-runs the flexbox pass and
// the screen recenters. Panels are deliberately different heights to show it.
import { Button, Column, Row, Tab, Tabs, Text } from "@zabloo/react";

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <Row layout={{ gap: 8, justify: "space-between", width: 320 }}>
      <Text style={{ color: "{color.text.muted}" }}>{label}</Text>
      <Text style={{ color: "{color.text}" }}>{value}</Text>
    </Row>
  );
}

export default function Settings() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: 16 }}>
      <Text style={{ color: "{color.text}", fontSize: 20 }}>Ajustes</Text>

      <Tabs
        id="settings-tabs"
        selected={0}
        layout={{ gap: 12, align: "center" }}
        bar={{ layout: { gap: 8 } }}
      >
        <Tab
          id="tab-video"
          variant="tab"
          autofocus
          layout={{ padding: "{space.2}" }}
          label={<Text style={{ color: "{color.text}", fontSize: 18 }}>Video</Text>}
          panel={{
            id: "panel-video",
            layout: { padding: "{space.4}", gap: 8 },
            style: {
              background: "{color.bg.panel}",
              radius: "{radius.md}",
              borderWidth: 1,
              borderColor: "{color.border}",
            },
          }}
        >
          <SettingRow label="Resolución" value="1920 × 1080" />
          <SettingRow label="Pantalla completa" value="Sí" />
          <SettingRow label="V-Sync" value="Activado" />
          <SettingRow label="Calidad" value="Alta" />
        </Tab>

        <Tab
          id="tab-audio"
          variant="tab"
          layout={{ padding: "{space.2}" }}
          label={<Text style={{ color: "{color.text}", fontSize: 18 }}>Audio</Text>}
          panel={{
            id: "panel-audio",
            layout: { padding: "{space.4}", gap: 8 },
            style: {
              background: "{color.bg.panel}",
              radius: "{radius.md}",
              borderWidth: 1,
              borderColor: "{color.border}",
            },
          }}
        >
          <SettingRow label="Volumen general" value="80" />
          <SettingRow label="Música" value="60" />
          {/* A plain Button inside a panel: tab selection and named actions coexist. */}
          <Button id="test-audio" onClick="test-audio" layout={{ padding: "{space.2}" }}>
            <Text style={{ color: "{color.text}" }}>Probar sonido</Text>
          </Button>
        </Tab>

        {/* A bare string label is wrapped in <Text> by the sugar. */}
        <Tab
          id="tab-controls"
          variant="tab"
          layout={{ padding: "{space.2}" }}
          label="Controles"
          panel={{
            id: "panel-controls",
            layout: { padding: "{space.4}", gap: 8 },
            style: {
              background: "{color.bg.panel}",
              radius: "{radius.md}",
              borderWidth: 1,
              borderColor: "{color.border}",
            },
          }}
        >
          <SettingRow label="Saltar" value="Espacio" />
          <SettingRow label="Correr" value="Shift" />
        </Tab>
      </Tabs>

      <Text style={{ color: "{color.text.muted}" }}>
        Tap o flechas + Enter — el panel activo es el único en el layout
      </Text>
    </Column>
  );
}
