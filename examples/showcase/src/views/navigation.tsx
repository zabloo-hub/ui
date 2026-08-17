// View "navigation" (file-based convention: the filename is the view ID).
//
// Put the mouse down and drive this page with the arrows, Enter and Escape — or
// with a gamepad, which goes through the very same intentions (d-pad and left
// stick → move, A → press, B → dismiss, right stick → scroll).
//
// Navigation is SPATIAL and automatic: the runtime moves the focus using the
// live layout rects it already has (a candidate must lie in the direction of
// travel; `score = projection + 2 × orthogonal`, lowest wins). So the IR
// carries almost nothing about it:
//
//  - **Focusability is not a field.** It derives from node type — Button,
//    Toggle, Slider, TextInput and a Collapse's header. Nothing else can hold
//    the focus, and `hover` lights up exactly the same set, so a pointer and a
//    pad see the same UI.
//  - **`autofocus`** is the only prop, and it marks where the focus starts.
//  - **`states.focused`** is how it is drawn — an ordinary state, merged under
//    `pressed` and over `hover`.
//
// Nothing is wired: no neighbour lists, no tab indices. Which is the point — a
// hot-updated screen, a Collapse opening, a resized window or a list arriving
// from the game all change the rects, and the navigation is recomputed from
// them rather than from a graph someone had to keep in sync.

import {
  Button,
  Checkbox,
  Container,
  List,
  Modal,
  Row,
  ScrollView,
  Slider,
  Switch,
  Text,
  TextInput,
} from "@zabloo/react";
import { Screen, Section } from "../components/Frame";

const BTN = { padding: "{space.2}", justify: "center", align: "center", width: 150 } as const;
const ROWS = Array.from({ length: 14 }, (_, i) => ({ id: `row-${i}`, number: i + 1 }));
const CELLS = [
  ["Inventory", "Map", "Quests"],
  ["Skills", "Crafting", "Journal"],
  ["Party", "Options", "Quit"],
];

export default function NavigationView() {
  return (
    <Screen
      title="Navigation"
      hint="Arrows to move · Enter to activate · Escape to dismiss · a pad does the same through the same code"
    >
      <Section
        title="Spatial focus"
        note="Three rows of three. Moving right from the middle picks the neighbour that is actually to the right — not the next node in document order, which is what a tab index would have given you."
        layout={{ direction: "column", align: "start", gap: "{space.2}" }}
      >
        {CELLS.map((row, y) => (
          <Row key={row[0]} layout={{ gap: "{space.2}" }}>
            {row.map((label, x) => (
              <Button
                key={label}
                id={`nav-${label.toLowerCase()}`}
                variant="secondary"
                layout={BTN}
                autofocus={x === 1 && y === 1}
                onClick={`nav-${label.toLowerCase()}`}
              >
                <Text variant="label">{label}</Text>
              </Button>
            ))}
          </Row>
        ))}
        <Text variant="muted">
          "Crafting" carries `autofocus`, so that is where the focus starts. Skip a row by pressing
          ↓ twice — the ring never lands on the panel or the captions, because a Container is not
          focusable and never will be.
        </Text>
      </Section>

      <Section
        title="Mixed controls take part on equal terms"
        note="Focusability is by type, so a slider, a toggle and a field are stops on the same walk. The slider keeps ←/→ for its own value and hands ↑/↓ back to the navigation; the field keeps ←/→ for the caret until the caret hits the end."
        layout={{ direction: "column", align: "stretch", gap: "{space.2}" }}
      >
        <Row layout={{ gap: "{space.3}", align: "center", wrap: true }}>
          <Switch
            id="nav-switch"
            variant="row"
            checked={{ bind: "nav.sound" }}
            layout={{ padding: "{space.2}", width: 200 }}
          >
            <Text variant="label">Sound</Text>
          </Switch>
          <Slider
            id="nav-slider"
            variant="setting"
            value={{ bind: "nav.volume" }}
            min={0}
            max={100}
            step={10}
            length={200}
            fill={{ background: "{color.accent}" }}
          />
          <TextInput
            id="nav-field"
            variant="field"
            value={{ bind: "nav.name" }}
            placeholder="Name"
            width={180}
          />
          <Button id="nav-apply" variant="primary" layout={BTN} onClick="nav-apply">
            <Text style={{ color: "{color.on-accent}", fontSize: "{text.md}" }}>Apply</Text>
          </Button>
        </Row>
      </Section>

      <Section
        title="The focus drags the scroller"
        note="Walk down past the fold: each ScrollView reveals the child of its own that holds the focus, by the smallest movement that works, and nested scrollers converge in one pass. It is behavior in the SDK — nothing in the IR asks for it."
        layout={{ direction: "column", align: "stretch" }}
      >
        <ScrollView
          id="nav-list"
          layout={{ height: 200, padding: "{space.2}", gap: "{space.1}", align: "stretch" }}
          style={{ background: "{color.panel}", radius: "{radius.md}" }}
        >
          {ROWS.map((row) => (
            <Row key={row.id} layout={{ gap: "{space.2}", align: "center" }}>
              <Text variant="muted" layout={{ width: 28 }}>{`${row.number}`}</Text>
              <Button
                id={row.id}
                variant="quiet"
                layout={{ padding: "{space.2}", grow: 1 }}
                onClick="row-pick"
              >
                <Text variant="label">{`Row ${row.number} — walk down here and watch it follow`}</Text>
              </Button>
              {/* No binding at all, on purpose: the SDK still owns the checked
                  state and the control still works — a binding is how the GAME
                  hears about it, not what makes it tick. */}
              <Checkbox id={`${row.id}-check`} size={20} />
            </Row>
          ))}
        </ScrollView>
      </Section>

      <Section
        title="A modal traps the focus"
        note="The trap derives from `modal` — there is no field for it. While the dialog is up, the arrows only reach candidates inside it; closing gives the focus back to whatever had it, which here is the button that opened it."
        layout={{ align: "center", gap: "{space.3}" }}
      >
        {/* The button only FIRES an action — a real game would answer it with a
            SetData on the flag, and the preview just logs it. The switch is
            bound to that same flag, so it is what opens the dialog here. */}
        <Button id="nav-open-modal" variant="primary" layout={BTN} onClick="nav-open">
          <Text style={{ color: "{color.on-accent}", fontSize: "{text.md}" }}>Ask to open</Text>
        </Button>
        <Switch
          id="nav-modal-switch"
          variant="row"
          checked={{ bind: "nav.dialogOpen" }}
          layout={{ padding: "{space.2}", width: 260 }}
        >
          <Text variant="label">Open the dialog (writes the flag)</Text>
        </Switch>
        <Text variant="muted">
          Try to walk out of it with the arrows: you cannot. Escape (or B) closes it — and the
          switch drops by itself, because the dismiss wrote `false` back through the binding.
        </Text>
      </Section>

      <Section
        title="A list from data is navigable the moment it arrives"
        note="Push `nav.items` and the rows become stops on the walk — nothing was wired, because there was nothing to wire."
        layout={{ direction: "column", align: "stretch" }}
      >
        <List
          items="nav.items"
          as="it"
          keyPath="id"
          layout={{ direction: "row", gap: "{space.2}", wrap: true }}
          empty={
            <Container layout={{ height: 56, justify: "center", align: "center" }}>
              <Text variant="muted">
                {
                  'zabloo.setData("nav.items", [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }])'
                }
              </Text>
            </Container>
          }
        >
          {(it) => (
            <Button variant="chip" layout={{ padding: "{space.2}" }} onClick="pick-item">
              <Text bind={it("name")} variant="label" />
            </Button>
          )}
        </List>
      </Section>

      <Modal
        id="nav-dialog"
        visible={{ bind: "nav.dialogOpen" }}
        onDismiss="nav-dismissed"
        transition={{ duration: "{motion.base}" }}
      >
        <Text variant="heading">Trapped</Text>
        <Text variant="body">
          Every arrow lands inside this panel. Nothing behind it takes a click either — a modal
          captures the input below it, and the backdrop is this overlay's own background.
        </Text>
        <Row layout={{ gap: "{space.2}", justify: "end" }}>
          <Button variant="quiet" layout={BTN} onClick="nav-dismissed">
            <Text variant="label">Cancel</Text>
          </Button>
          <Button variant="primary" layout={BTN} autofocus onClick="nav-confirm">
            <Text style={{ color: "{color.on-accent}", fontSize: "{text.md}" }}>Confirm</Text>
          </Button>
        </Row>
      </Modal>
    </Screen>
  );
}
