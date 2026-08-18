// View "main-menu" (file-based convention: the filename is the view ID).
// Slice targets: pressable Button, Collapse (runtime relayout) and Accordion
// (flattened composite: Container + group "exclusive-open").
import {
  Accordion,
  Badge,
  Button,
  Collapse,
  Column,
  ProgressBar,
  Row,
  Spinner,
  Text,
} from "@zabloo/react";

export default function MainMenu() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: 16 }}>
      <Row layout={{ gap: 8 }}>
        <Text style={{ color: "#facc15", fontSize: 20 }}>Gold:</Text>
        <Text bind="player.gold" style={{ color: "#facc15", fontSize: 20 }} />
      </Row>

      {/* The bar tweens its VALUE, not its rect: push player.hp from the preview
          panel and the fill glides there — and retargets mid-glide if you push
          again. The track clips, so the fill keeps its rounded ends. */}
      <Row layout={{ gap: 8, align: "center" }}>
        <Text style={{ color: "#9aa4b2" }}>Health</Text>
        <ProgressBar
          id="hp"
          value={{ bind: "player.hp" }}
          transition={{ duration: "{motion.slow}", easing: "ease-out" }}
          layout={{ width: 200 }}
          fill={{ background: "#22c55e" }}
        />
      </Row>

      {/* The loop is SDK behavior: no transform in v1, so the beads pulse in a
          travelling wave instead of spinning. `motion.loop` themes its speed. */}
      <Row layout={{ gap: 8, align: "center" }}>
        <Spinner period="{motion.loop}" />
        <Text style={{ color: "#9aa4b2" }}>Loading save</Text>
      </Row>

      <Row layout={{ gap: 12 }}>
        {/* `transition` tweens whatever moves, with no trigger list: the pressed
            background and the focus ring's borderWidth here. Releasing mid-tween
            leaves from the color on screen — it never snaps back. */}
        <Button
          id="buy-btn"
          variant="primary"
          autofocus
          onClick="buy"
          transition={{ duration: "{motion.fast}" }}
          layout={{ padding: "{space.4}" }}
        >
          <Text style={{ color: "{color.on-primary}", fontSize: 24 }}>Buy</Text>
        </Button>
        <Button
          id="quit-btn"
          variant="secondary"
          onClick="quit"
          transition={{ duration: "{motion.slow}", easing: "ease-in-out" }}
          layout={{ padding: "{space.4}" }}
        >
          <Text style={{ color: "#c8cede", fontSize: 24 }}>Quit</Text>
        </Button>
      </Row>

      <Text visible={{ bind: "shop.thanked" }} style={{ color: "#4ade80" }}>
        Thanks for your purchase
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
          Options
        </Text>
        <Text style={{ color: "#9aa4b2" }}>Sound: high</Text>
        <Text style={{ color: "#9aa4b2" }}>Language: en</Text>
        <Text style={{ color: "#9aa4b2" }}>Rumble: on</Text>
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
            Quests
          </Text>
          <Text style={{ color: "#9aa4b2" }}>Slay the dragon</Text>
          <Text style={{ color: "#9aa4b2" }}>Collect 10 gems</Text>
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
            Inventory
          </Text>
          <Text style={{ color: "#9aa4b2" }}>Iron sword</Text>
          <Text style={{ color: "#9aa4b2" }}>Potion x3</Text>
        </Collapse>
        <Collapse
          id="social"
          open={false}
          layout={{ padding: "{space.2}", gap: 8 }}
          style={{ background: "#1f2430", radius: "{radius.md}" }}
        >
          {/* Header row: the Badge is a flattened composite (Container + bound
              Text), so the counter follows inbox.unread with no IR of its own. */}
          <Row
            layout={{ gap: 8, align: "center" }}
            states={{ focused: { style: { borderWidth: 1, borderColor: "#a5b4fc", radius: 4 } } }}
          >
            <Text style={{ color: "#ffffff", fontSize: 18 }}>Social</Text>
            <Badge count={{ bind: "inbox.unread" }} />
          </Row>
          <Text style={{ color: "#9aa4b2" }}>3 friends online</Text>
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
