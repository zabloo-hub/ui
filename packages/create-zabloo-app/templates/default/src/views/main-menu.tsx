// Every .tsx in src/views/ is one document of the exported envelope; the
// filename is the view ID the SDK loads by (`export const id = "…"` pins a
// stable ID if you rename the file).
import { Button, Collapse, Column, Row, Text } from "@zabloo/react";
import { GoldRow } from "../components/GoldRow";

export default function MainMenu() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: 16 }}>
      <GoldRow />

      <Row layout={{ gap: 12 }}>
        <Button variant="primary" autofocus onClick="play" layout={{ padding: "{space.4}" }}>
          <Text style={{ color: "{color.on-primary}", fontSize: 24 }}>Play</Text>
        </Button>
        <Button variant="secondary" onClick="quit" layout={{ padding: "{space.4}" }}>
          <Text style={{ color: "#c8cede", fontSize: 24 }}>Quit</Text>
        </Button>
      </Row>

      <Collapse
        id="options"
        open={false}
        layout={{ padding: "{space.2}", gap: 8 }}
        style={{
          background: "{color.surface}",
          radius: "{radius.md}",
          borderWidth: 1,
          borderColor: "#3b4160",
        }}
      >
        <Text
          states={{ focused: { style: { color: "#a5b4fc" } } }}
          style={{ color: "#ffffff", fontSize: 18 }}
        >
          Options
        </Text>
        <Text style={{ color: "{color.muted}" }}>Sound: on</Text>
        <Text style={{ color: "{color.muted}" }}>Language: en</Text>
      </Collapse>

      {/* Opacity inherits multiplicatively: 0.5 on the Row dims both Texts. */}
      <Row layout={{ gap: 6 }} style={{ opacity: 0.5 }}>
        <Text style={{ color: "{color.muted}" }}>my-game-ui</Text>
        <Text style={{ color: "{color.muted}" }}>— demo build</Text>
      </Row>
    </Column>
  );
}
