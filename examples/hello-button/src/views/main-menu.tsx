// View "main-menu" (file-based convention: the filename is the view ID).
// Slice targets: pressable Button, Collapse (runtime relayout) and Accordion
// (flattened composite: Container + group "exclusive-open").
import { Accordion, Button, Collapse, Column, Row, Text } from "@zabloo/react";

export default function MainMenu() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: 16 }}>
      <Row layout={{ gap: 8 }}>
        <Text style={{ color: "#facc15", fontSize: 20 }}>Oro:</Text>
        <Text bind="player.gold" style={{ color: "#facc15", fontSize: 20 }} />
      </Row>

      <Row layout={{ gap: 12 }}>
        <Button
          id="buy-btn"
          variant="primary"
          autofocus
          onClick="buy"
          layout={{ padding: "{space.4}" }}
        >
          <Text style={{ color: "{color.on-primary}", fontSize: 24 }}>Comprar</Text>
        </Button>
        <Button id="quit-btn" variant="secondary" onClick="quit" layout={{ padding: "{space.4}" }}>
          <Text style={{ color: "#c8cede", fontSize: 24 }}>Salir</Text>
        </Button>
      </Row>

      <Text visible={{ bind: "shop.thanked" }} style={{ color: "#4ade80" }}>
        Gracias por tu compra
      </Text>

      <Collapse
        id="options"
        open={false}
        layout={{ padding: "{space.2}", gap: 8 }}
        style={{
          background: "#1f2430",
          radius: "{radius.md}",
          borderWidth: 1,
          borderColor: "#3b4160",
        }}
      >
        <Text
          states={{ focused: { style: { color: "#a5b4fc" } } }}
          style={{ color: "#ffffff", fontSize: 18 }}
        >
          Opciones
        </Text>
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
          <Text
            states={{ focused: { style: { color: "#a5b4fc" } } }}
            style={{ color: "#ffffff", fontSize: 18 }}
          >
            Misiones
          </Text>
          <Text style={{ color: "#9aa4b2" }}>Derrota al dragon</Text>
          <Text style={{ color: "#9aa4b2" }}>Recoge 10 gemas</Text>
        </Collapse>
        <Collapse
          id="inventory"
          open={false}
          layout={{ padding: "{space.2}", gap: 8 }}
          style={{ background: "#1f2430", radius: "{radius.md}" }}
        >
          <Text
            states={{ focused: { style: { color: "#a5b4fc" } } }}
            style={{ color: "#ffffff", fontSize: 18 }}
          >
            Inventario
          </Text>
          <Text style={{ color: "#9aa4b2" }}>Espada de hierro</Text>
          <Text style={{ color: "#9aa4b2" }}>Pocion x3</Text>
        </Collapse>
        <Collapse
          id="social"
          open={false}
          layout={{ padding: "{space.2}", gap: 8 }}
          style={{ background: "#1f2430", radius: "{radius.md}" }}
        >
          <Text
            states={{ focused: { style: { color: "#a5b4fc" } } }}
            style={{ color: "#ffffff", fontSize: 18 }}
          >
            Social
          </Text>
          <Text style={{ color: "#9aa4b2" }}>3 amigos conectados</Text>
        </Collapse>
      </Accordion>

      {/* Opacity inherits multiplicatively: 0.5 on the Row dims both Texts. */}
      <Row layout={{ gap: 6 }} style={{ opacity: 0.5 }}>
        <Text style={{ color: "#9aa4b2" }}>zabloo/ui</Text>
        <Text style={{ color: "#9aa4b2" }}>— demo build</Text>
      </Row>
    </Column>
  );
}
