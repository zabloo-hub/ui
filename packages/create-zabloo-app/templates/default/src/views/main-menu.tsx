// Every .tsx in src/views/ is one document of the exported envelope; the
// filename is the view ID the SDK loads by (`export const id = "…"` pins a
// stable ID if you rename the file).
import { Button, Collapse, Column, Image, Row, Switch, Text } from "@zabloo/react";
import { GoldRow } from "../components/GoldRow";

export default function MainMenu() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: 16 }}>
      {/* Images live in src/assets/ and are referenced by path: `zabloo export`
          hashes the file and inlines it in the envelope, so the game gets the
          bytes with the UI. Everything else is plain style — `color` tints the
          picture (this logo is white, so it takes the tint), `radius` rounds it,
          and `background` is what you see while the bytes decode. Sized here;
          without layout width/height it takes its own pixel size, and `fit`
          ("contain" | "cover" | "stretch") chooses how it fills the box. */}
      <Image
        src="logo.png"
        layout={{ width: 88, height: 88 }}
        style={{
          color: "{color.primary}",
          background: "{color.surface}",
          radius: "{radius.md}",
        }}
      />

      <GoldRow />

      {/* Motion comes from the theme (`transitions` in src/theme.ts), so these
          buttons fade between hover, pressed and their focus ring without a prop
          here. A transition starts whenever a resolved value changes — there is
          no trigger list — and an interruption leaves from the color on screen,
          so releasing mid-animation never snaps back. */}
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
        {/* Opening and closing animates the Collapse's own height, between the
            header's box and the height measured with the content in — the box
            clips while it moves, and what is below it slides along. */}
        <Switch checked={{ bind: "settings.sfx" }} onChange="sfx-changed">
          <Text style={{ color: "{color.muted}" }}>Sound</Text>
        </Switch>
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
