// View "scroll-demo" (file-based convention: the filename is the view ID).
// Manual test bed for ZAB-8: wheel + drag scroll input, clamped at both
// ends. Item 7 is a Button, to confirm drag-to-scroll doesn't eat clicks on
// interactive content nested inside the ScrollView.
import { Button, Column, Container, Row, ScrollView, Text } from "@zabloo/react";

const ITEMS = Array.from({ length: 20 }, (_, i) => `Item ${i + 1}`);

export default function ScrollDemo() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: 16 }}>
      <Text style={{ color: "#eceff4", fontSize: 18 }}>Wheel or drag inside the list</Text>

      <ScrollView
        id="inventory"
        axis="vertical"
        layout={{ width: 320, height: 280, align: "stretch" }}
        style={{
          background: "#141822",
          radius: "{radius.md}",
          borderWidth: 1,
          borderColor: "{color.border}",
        }}
      >
        {ITEMS.map((label, i) =>
          i === 6 ? (
            <Button
              key={label}
              id="item-7-btn"
              onClick="use-item-7"
              layout={{ height: 56, padding: "{space.2}" }}
              style={{ background: i % 2 === 0 ? "{color.row.even}" : "{color.row.odd}" }}
            >
              <Text style={{ color: "#a5b4fc", fontSize: 16 }}>{label} (tap me)</Text>
            </Button>
          ) : (
            <Container
              key={label}
              layout={{ height: 56, padding: "{space.2}" }}
              style={{ background: i % 2 === 0 ? "{color.row.even}" : "{color.row.odd}" }}
            >
              <Row layout={{ align: "center" }}>
                <Text style={{ color: "#ffffff", fontSize: 16 }}>{label}</Text>
              </Row>
            </Container>
          ),
        )}
      </ScrollView>
    </Column>
  );
}
