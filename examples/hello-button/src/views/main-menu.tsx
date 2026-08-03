// View "main-menu" (file-based convention: the filename is the view ID).
// The vertical-slice target: one screen, one pressable Button.
import { Button, Column, Text } from "@zabloo/react";

export default function MainMenu() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center" }}>
      <Button
        id="buy-btn"
        onClick="buy"
        layout={{ padding: "{space.4}" }}
        style={{ background: "{color.primary}", radius: "{radius.md}" }}
        states={{ pressed: { style: { background: "{color.primary.hover}" } } }}
      >
        <Text style={{ color: "{color.on-primary}", fontSize: 24 }}>Comprar</Text>
      </Button>
    </Column>
  );
}
