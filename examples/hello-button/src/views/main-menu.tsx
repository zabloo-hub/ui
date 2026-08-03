// View "main-menu" (file-based convention: the filename is the view ID).
// Slice targets: pressable Button, Collapse (runtime relayout) and Accordion
// (flattened composite: Container + group "exclusive-open").
import { Accordion, Button, Collapse, Column, Text } from "@zabloo/react";

export default function MainMenu() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: 16 }}>
      <Button
        id="buy-btn"
        onClick="buy"
        layout={{ padding: "{space.4}" }}
        style={{ background: "{color.primary}", radius: "{radius.md}" }}
        states={{ pressed: { style: { background: "{color.primary.hover}" } } }}
      >
        <Text style={{ color: "{color.on-primary}", fontSize: 24 }}>Comprar</Text>
      </Button>

      <Collapse
        id="options"
        open={false}
        layout={{ padding: "{space.2}", gap: 8 }}
        style={{ background: "#1f2430", radius: "{radius.md}" }}
      >
        <Text style={{ color: "#ffffff", fontSize: 18 }}>Opciones</Text>
        <Text style={{ color: "#9aa4b2" }}>Sonido: alto</Text>
        <Text style={{ color: "#9aa4b2" }}>Idioma: es</Text>
        <Text style={{ color: "#9aa4b2" }}>Vibracion: si</Text>
      </Collapse>

      <Accordion id="menu" layout={{ gap: 4 }}>
        <Collapse
          id="missions"
          open
          layout={{ padding: "{space.2}", gap: 8 }}
          style={{ background: "#1f2430", radius: "{radius.md}" }}
        >
          <Text style={{ color: "#ffffff", fontSize: 18 }}>Misiones</Text>
          <Text style={{ color: "#9aa4b2" }}>Derrota al dragon</Text>
          <Text style={{ color: "#9aa4b2" }}>Recoge 10 gemas</Text>
        </Collapse>
        <Collapse
          id="inventory"
          open={false}
          layout={{ padding: "{space.2}", gap: 8 }}
          style={{ background: "#1f2430", radius: "{radius.md}" }}
        >
          <Text style={{ color: "#ffffff", fontSize: 18 }}>Inventario</Text>
          <Text style={{ color: "#9aa4b2" }}>Espada de hierro</Text>
          <Text style={{ color: "#9aa4b2" }}>Pocion x3</Text>
        </Collapse>
        <Collapse
          id="social"
          open={false}
          layout={{ padding: "{space.2}", gap: 8 }}
          style={{ background: "#1f2430", radius: "{radius.md}" }}
        >
          <Text style={{ color: "#ffffff", fontSize: 18 }}>Social</Text>
          <Text style={{ color: "#9aa4b2" }}>3 amigos conectados</Text>
        </Collapse>
      </Accordion>
    </Column>
  );
}
