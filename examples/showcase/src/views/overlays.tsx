// View "overlays" (file-based convention: the filename is the view ID).
//
// An `Overlay` is declared where the UI that opens it lives, but it leaves its
// parent's flow: it takes no space, pushes no sibling, and the SDK collects
// every visible one into ONE layer above the whole view, ordered by (z, document
// order). That is why the switches below do not move when a modal opens.
//
// Three things it does NOT have, and each absence is a decision:
//  - No `backdrop` field: the overlay's own `background` (with alpha) IS the
//    backdrop, because paint stays implicit from style.
//  - No position field: its rect is the VIEW's, so `justify`/`align` place the
//    content with the flex that already exists. `<Modal>`/`<Toast>`/`<Tooltip>`
//    wrap that in a `position` prop with nine names.
//  - No `open`: `visible` is the single mechanism, bound to a flag the game
//    owns. A dismiss (Escape, gamepad B, a tap on the backdrop, a timer) writes
//    `false` back through that same binding — which is why the switch turns
//    itself off when you close a dialog.
//
// The exceptions are ANCHORED overlays: a `trigger` of "hover" rides the
// anchor's hover OR focus (the same hint reaches a gamepad through the focus,
// with no second mechanism), and "press" makes the anchor's press own an open
// state the SDK keeps — the popover, which is what makes `<Select>` expressible
// without a primitive of its own.

import {
  Button,
  Column,
  Container,
  Modal,
  Overlay,
  Row,
  Switch,
  Text,
  Toast,
  Tooltip,
} from "@zabloo/react";
import { Screen, Section } from "../components/Frame";

const BTN = { padding: "{space.2}", justify: "center", align: "center" } as const;
const FADE = { duration: "{motion.base}" } as const;

/** The nine placements of `AnchorAt`, in the order they read on screen. */
const ANCHORS = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;

export default function OverlaysView() {
  return (
    <Screen title="Overlays" hint="One layer above the view — declared in place, painted apart">
      <Section
        title="Opened by a binding"
        note="Flip a switch: it writes the flag the overlay's `visible` reads. Dismiss the dialog and the switch goes back down by itself, because the SDK wrote `false` through the same binding."
        layout={{ direction: "column", align: "stretch", gap: "{space.2}" }}
      >
        <Switch
          id="sw-modal"
          variant="row"
          checked={{ bind: "ui.confirmOpen" }}
          layout={{ padding: "{space.2}" }}
        >
          <Text variant="label">Modal — dims, captures input below, traps the focus</Text>
        </Switch>
        <Switch
          id="sw-toast"
          variant="row"
          checked={{ bind: "ui.saved" }}
          layout={{ padding: "{space.2}" }}
        >
          <Text variant="label">Toast — not modal, closes itself after 3 s</Text>
        </Switch>
        <Switch
          id="sw-hint"
          variant="row"
          checked={{ bind: "ui.hint" }}
          layout={{ padding: "{space.2}" }}
        >
          <Text variant="label">Tooltip with no anchor — a hint the game turns on</Text>
        </Switch>
        <Switch
          id="sw-hud"
          variant="row"
          checked={{ bind: "ui.hud" }}
          layout={{ padding: "{space.2}" }}
        >
          <Text variant="label">Raw &lt;Overlay&gt; — no panel, no sugar, z: 30</Text>
        </Switch>
      </Section>

      <Section
        title="Anchored to a node"
        note='trigger="hover" is hover OR focus, so the pointer and the gamepad get the same hint. Tab through these with the keyboard and watch the bubbles follow the focus ring.'
        layout={{ direction: "column", align: "stretch", gap: "{space.2}" }}
      >
        <Row layout={{ gap: "{space.2}", wrap: true }}>
          {ANCHORS.map((at) => (
            <Button
              key={at}
              id={`anchor-${at}`}
              variant="secondary"
              layout={BTN}
              onClick={`hover-${at}`}
            >
              <Text variant="label">{at}</Text>
            </Button>
          ))}
        </Row>
        {ANCHORS.map((at) => (
          <Tooltip key={at} anchor={`anchor-${at}`} position={at} transition={FADE}>
            {`at: "${at}"`}
          </Tooltip>
        ))}
        <Text variant="muted">
          `top-left` means ABOVE, flush with the anchor's left edge — a side plus an alignment, not
          a diagonal. `center` sits ON the anchor and ignores the offset.
        </Text>
      </Section>

      <Section
        title="Flip and clamp"
        note="Placement is deterministic and has no field of its own: if the preferred side has no room and the opposite one does, it flips; then it is clamped into the view. Narrow the window until the right-hand bubble jumps to the other side."
        layout={{ justify: "space-between", align: "center" }}
      >
        <Button id="edge-left" variant="secondary" layout={BTN} onClick="edge-left">
          <Text variant="label">Hover me (opens right)</Text>
        </Button>
        <Button id="edge-right" variant="secondary" layout={BTN} onClick="edge-right">
          <Text variant="label">Hover me (wants the right too)</Text>
        </Button>
        <Tooltip anchor="edge-left" position="right" transition={FADE}>
          There is room on this side, so it stays here.
        </Tooltip>
        <Tooltip anchor="edge-right" position="right" transition={FADE}>
          No room on the right of this one: it flips to the left instead of hanging off the view.
        </Tooltip>
      </Section>

      <Section
        title="Popover"
        note='trigger="press" is the one open state an Overlay owns itself. Pressing the anchor toggles it (its own onClick still fires), a dismiss closes it, and so does a selection inside — which is exactly the contract <Select> is built out of.'
      >
        <Button id="menu-btn" variant="primary" layout={BTN} onClick="menu-pressed">
          <Text style={{ color: "{color.on-accent}", fontSize: "{text.md}" }}>Actions</Text>
        </Button>
        {/* The raw primitive: no panel prop, no position sugar — its children ARE
            its children, which is why it is the one composite-free overlay we
            export. `modal` keeps the press outside it from falling through. */}
        <Overlay
          id="menu"
          modal
          z={20}
          transition={FADE}
          anchor={{ id: "menu-btn", at: "bottom-left", offset: 6, trigger: "press" }}
        >
          <Column
            layout={{ width: 200, padding: "{space.1}", gap: "{space.1}", align: "stretch" }}
            style={{
              background: "{color.panel}",
              radius: "{radius.md}",
              borderWidth: 1,
              borderColor: "{color.border}",
            }}
          >
            {["Rename", "Duplicate", "Export"].map((action) => (
              <Button
                key={action}
                variant="quiet"
                layout={{ padding: "{space.2}" }}
                onClick={`menu-${action.toLowerCase()}`}
              >
                <Text variant="label">{action}</Text>
              </Button>
            ))}
          </Column>
        </Overlay>
      </Section>

      {/* Nested modals: the inner one is declared INSIDE the outer, leaves the
          flow just the same and flattens into the same layer, higher up by
          document order. While it is open, it is the one capturing input and
          holding the focus; closing it gives the focus back to what had it. */}
      <Modal
        id="confirm"
        visible={{ bind: "ui.confirmOpen" }}
        onDismiss="quit-cancelled"
        transition={FADE}
      >
        <Text variant="heading">Leave the run?</Text>
        <Text variant="body">You will lose everything since the last checkpoint.</Text>
        <Row layout={{ gap: "{space.2}", justify: "end" }}>
          <Button variant="quiet" layout={BTN} onClick="details-open">
            <Text variant="label">Details</Text>
          </Button>
          <Button variant="quiet" layout={BTN} onClick="quit-cancelled">
            <Text variant="label">Cancel</Text>
          </Button>
          <Button variant="danger" layout={BTN} autofocus onClick="quit-confirm">
            <Text style={{ color: "{color.on-accent}", fontSize: "{text.md}" }}>Leave</Text>
          </Button>
        </Row>

        <Modal
          id="details"
          visible={{ bind: "ui.detailsOpen" }}
          onDismiss="details-closed"
          transition={{ duration: "{motion.fast}" }}
          panel={{ layout: { width: 260 } }}
        >
          <Text variant="body">Last checkpoint: 12 minutes ago.</Text>
          <Button variant="quiet" layout={BTN} autofocus onClick="details-closed">
            <Text variant="label">Got it</Text>
          </Button>
        </Modal>
      </Modal>

      <Toast visible={{ bind: "ui.saved" }} onDismiss="toast-closed" transition={FADE}>
        Progress saved
      </Toast>

      <Tooltip visible={{ bind: "ui.hint" }} position="bottom" transition={FADE}>
        Press A to jump
      </Tooltip>

      {/* A raw Overlay with no background is a transparent layer: it paints above
          everything and, being non-modal, leaves its own rect inert — only its
          children take input, so the page underneath stays usable. */}
      <Overlay
        id="hud"
        modal={false}
        z={30}
        visible={{ bind: "ui.hud" }}
        transition={FADE}
        layout={{ justify: "start", align: "end", padding: "{space.4}" }}
      >
        <Container
          layout={{ padding: "{space.2}", gap: "{space.1}" }}
          style={{ background: "{color.accent}", radius: "{radius.md}", opacity: 0.9 }}
        >
          <Text style={{ color: "{color.on-accent}", fontSize: "{text.md}" }}>
            HUD corner — z: 30, over every other overlay here
          </Text>
        </Container>
      </Overlay>
    </Screen>
  );
}
