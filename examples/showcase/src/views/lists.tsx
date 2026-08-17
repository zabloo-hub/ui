// View "lists" (file-based convention: the filename is the view ID).
//
// The one node whose CHILDREN come from data instead of from the document
// (`Repeat`, decision 2026-08-11 ZAB-29). Everything else on this page is
// authoring sugar over it: `<List>` is a Repeat laid out on one axis, `<Grid>`
// is a Repeat whose row wraps.
//
// Nothing renders until data arrives — the document carries structure, the game
// carries content. Paste this in the preview's console to fill the page:
//
//   zabloo.setData("shop.items", Array.from({ length: 400 }, (_, i) => ({
//     id: "item-" + i, name: "Item " + i, price: 20 + i * 3,
//   })))
//   zabloo.setData("inventory.slots", Array.from({ length: 12 }, (_, i) => ({
//     id: "slot-" + i, tag: "0" + (i + 1),
//   })))
//   zabloo.setData("shop.categories", [
//     { id: "weapons", name: "Weapons", items: [{ id: "sword", name: "Sword" },
//       { id: "axe", name: "Axe" }] },
//     { id: "potions", name: "Potions", items: [{ id: "red", name: "Red vial" }] },
//   ])
//
// Four things to watch once it is full:
//  - Four hundred rows scroll without four hundred rows existing: the renderer
//    realizes the window the viewport can see plus a buffer, and reserves the
//    space of the rest.
//  - `keyPath="id"` is what keeps per-item state (a focus ring, a checked
//    Toggle) with the ITEM across a reorder instead of pinned to a position.
//  - Every row fires the same action name, and the payload says which row:
//    `buy → shop.items.7 (#7)` in the preview's log. An `id` on a template node
//    would be worn by all four hundred instances, which is why identity is data.
//  - A Toggle inside a row writes back INTO the array (`shop.items.7.fav`)
//    through the ordinary data channel — there is no per-component API.

import {
  Button,
  Checkbox,
  Column,
  Container,
  Grid,
  List,
  Row,
  ScrollView,
  Text,
} from "@zabloo/react";
import { Screen, Section } from "../components/Frame";

const ROW = { background: "{color.row}", radius: "{radius.md}" } as const;

/** The empty slot, which is a positional SLOT and not a condition: the IR has no expressions. */
function Empty({ message }: { message: string }) {
  return (
    <Container layout={{ height: 72, justify: "center", align: "center" }}>
      <Text variant="muted">{message}</Text>
    </Container>
  );
}

export default function ListsView() {
  return (
    <Screen
      title="Lists"
      hint="Structure driven by data — push an array from the console (see the file header)"
    >
      <Section
        title="List"
        note="One template, one bound array. The List IS the flex container of its instances, so gap/align lay them out like any other row of children."
        layout={{ direction: "column", align: "stretch" }}
      >
        <ScrollView
          id="catalogue"
          layout={{ height: 260, padding: "{space.2}", gap: "{space.1}", align: "stretch" }}
          style={{ background: "{color.panel}", radius: "{radius.md}" }}
        >
          {/* `as="it"` names the item scope. It is DECLARED rather than reserved
              so a nested list can still reach the element outside it — see the
              last section. */}
          <List
            items="shop.items"
            as="it"
            keyPath="id"
            layout={{ gap: "{space.1}", align: "stretch" }}
            empty={<Empty message="No items — push `shop.items` from the console" />}
          >
            {(it) => (
              <Row
                layout={{ height: 52, padding: "{space.2}", gap: "{space.2}", align: "center" }}
                style={ROW}
              >
                <Text bind={it.$index} variant="muted" layout={{ width: 30 }} />
                <Text bind={it("name")} variant="label" layout={{ grow: 1 }} />
                <Text bind={it("price")} style={{ color: "{color.gold}", fontSize: "{text.md}" }} />
                <Checkbox checked={{ bind: it("fav") }} onChange="favourite" size={20} />
                <Button variant="secondary" onClick="buy" layout={{ padding: "{space.2}" }}>
                  <Text variant="label">Buy</Text>
                </Button>
              </Row>
            )}
          </List>
        </ScrollView>
      </Section>

      <Section
        title="Grid"
        note="Also a Repeat: a row with `wrap`, whose cells carry a width so exactly `columns` fit per line. `columns` never reaches the IR — without fractional units the geometry is arithmetic, and arithmetic belongs to authoring."
        layout={{ direction: "column", align: "stretch" }}
      >
        {/* The gap is a NUMBER here, and it has to be: the cell width is solved
            in `zabloo export`, and a token is only resolved later, inside the
            SDK. It is the one place in the whole catalog where a Dim cannot be
            tokenized — the price of resolving a grid's geometry at authoring
            time instead of inventing fractional units. */}
        <Grid
          items="inventory.slots"
          as="slot"
          keyPath="id"
          columns={6}
          layout={{ width: 700, gap: 8 }}
          // `cell` is the container the grid sizes, so this is where the cell's
          // own look and alignment belong — the template is just its contents.
          cell={{
            layout: { height: 76, justify: "center", align: "center", gap: "{space.1}" },
            style: { background: "{color.row}", radius: "{radius.md}" },
          }}
          empty={<Empty message="No slots — push `inventory.slots`" />}
        >
          {(slot) => (
            <>
              <Text bind={slot("tag")} variant="label" />
              <Text bind={slot.$index} variant="muted" />
            </>
          )}
        </Grid>
      </Section>

      <Section
        title="Nested lists"
        note="The inner template reads both scopes: `cat.name` for the category it lives in, `entry.name` for the element itself. That is the whole reason the alias is a name you choose instead of a reserved word."
        layout={{ direction: "column", align: "stretch" }}
      >
        <List
          items="shop.categories"
          as="cat"
          keyPath="id"
          layout={{ gap: "{space.2}", align: "stretch" }}
          empty={<Empty message="No categories — push `shop.categories`" />}
        >
          {(cat) => (
            <Column
              layout={{ padding: "{space.2}", gap: "{space.1}", align: "stretch" }}
              style={{ background: "{color.panel}", radius: "{radius.md}" }}
            >
              <Text bind={cat("name")} variant="heading" />
              <List
                items={cat("items")}
                as="entry"
                keyPath="id"
                layout={{ gap: "{space.1}", align: "stretch" }}
              >
                {(entry) => (
                  <Row
                    layout={{ padding: "{space.2}", gap: "{space.2}", align: "center" }}
                    style={ROW}
                  >
                    <Text bind={entry("name")} variant="label" layout={{ grow: 1 }} />
                    <Text bind={cat("name")} variant="muted" />
                    <Button variant="quiet" onClick="pick" layout={{ padding: "{space.1}" }}>
                      <Text variant="muted">pick</Text>
                    </Button>
                  </Row>
                )}
              </List>
            </Column>
          )}
        </List>
      </Section>
    </Screen>
  );
}
