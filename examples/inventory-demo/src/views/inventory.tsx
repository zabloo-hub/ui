// View "inventory" (file-based convention: the filename is the view ID).
// Reference screen for data-driven lists inside a ScrollView: the catalogue is
// ONE item template bound to `shop.items`, and the game pushes the array. Feed
// it from the preview's data panel (paste JSON) or its console:
//
//   zabloo.setData("shop.items", Array.from({ length: 400 }, (_, i) => ({
//     id: "item-" + i, tag: "IT", name: "Item " + i,
//     detail: "Damage " + (i % 20) + " · Weight " + (i % 9), price: 20 + i * 3,
//   })))
//
// What each block is here to prove:
//  - Hundreds of items scroll fluidly: the renderer instantiates only the rows
//    the viewport can see (plus a buffer) and reserves the space of the rest, so
//    the work per frame does not grow with the array.
//  - Identity travels: with `keyPath="id"`, reordering or splicing the array
//    moves each row's state (its focused ring, its favourite Toggle) with the
//    item instead of leaving it pinned to a position.
//  - Writes go back through the same channel: the favourite Toggle inside a row
//    writes `shop.items.<n>.fav` — no per-component API — and the preview logs it.
//  - Actions say WHICH one: every row fires the same `buy`, and the payload
//    carries the item (`shop.items.<n>`, its key and its index). No id per row:
//    an `id` inside a template would be worn by every instance of it.
//  - The empty state (`empty`) is what shows before any data arrives, or when
//    the array is empty — the IR has no expressions, so it is a slot.
//  - The scroller's own rules still hold around the list: the category strip
//    scrolls on the other axis with no indicator, the <Collapse> inside the
//    scroller re-clamps the offset when it closes, and nothing paints outside
//    the panel.
import {
  Button,
  Checkbox,
  Collapse,
  Column,
  Container,
  List,
  Row,
  ScrollView,
  Text,
} from "@zabloo/react";

const CATEGORIES = [
  "All",
  "Weapons",
  "Armor",
  "Potions",
  "Materials",
  "Spells",
  "Mounts",
  "Cosmetics",
];

/** The rare section stays authored: it is the static content the list scrolls with. */
const RARE: Array<[string, string, string, number]> = [
  ["relic", "Relic of the dawn", "Unique · Holy light", 1500],
  ["grimoire", "Forbidden grimoire", "Unique · Dark spells", 1200],
  ["crown", "Crown of the fallen king", "Unique · Command +2", 2400],
];

const NAME = { color: "{color.text}", fontSize: 16 } as const;
const DETAIL = { color: "{color.text.muted}", fontSize: 13 } as const;
const PRICE = { color: "{color.gold}", fontSize: 15 } as const;
const ROW = { background: "{color.bg.row}", radius: "{radius.md}" } as const;
const ROW_LAYOUT = {
  height: 64,
  padding: "{space.2}",
  gap: "{space.2}",
  align: "center",
} as const;

/** A rare-section row: the same shape, built at authoring time from a tuple. */
function RareRow({ item }: { item: (typeof RARE)[number] }) {
  const [, name, detail, price] = item;
  return (
    <Row layout={ROW_LAYOUT} style={{ background: "{color.bg.row.alt}", radius: "{radius.md}" }}>
      <Column layout={{ grow: 1, gap: "{space.1}" }}>
        <Text style={NAME}>{name}</Text>
        <Text style={DETAIL}>{detail}</Text>
      </Column>
      <Text style={PRICE}>{`${price} gold`}</Text>
    </Row>
  );
}

export default function Inventory() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: "{space.4}" }}>
      <Row layout={{ width: 460, justify: "space-between", align: "center" }}>
        <Text style={{ color: "{color.text}", fontSize: 20 }}>Guild shop</Text>
        {/* Bound, like any other text: the preview's data panel (or the game's
            SetData) fills it — it is empty until someone sets `player.gold`. */}
        <Row layout={{ gap: "{space.1}", align: "center" }}>
          <Text style={PRICE}>Gold:</Text>
          <Text bind="player.gold" style={PRICE} />
        </Row>
      </Row>

      {/* Horizontal scroller: the chips run off the right edge and the strip has
          no indicator — `scrollbar={false}` — because the cut-off chip already
          says there is more. Input is axis-faithful today, so it takes a
          HORIZONTAL gesture (trackpad swipe = wheel deltaX, or a drag started
          between chips): a plain wheel is deltaY, which this axis ignores, and
          a drag started ON a chip presses the Button instead of scrolling. */}
      <ScrollView
        id="categories"
        axis="horizontal"
        scrollbar={false}
        layout={{
          direction: "row",
          width: 460,
          gap: "{space.2}",
          padding: "{space.1}",
          align: "center",
        }}
      >
        {CATEGORIES.map((category) => (
          <Button
            key={category}
            id={`category-${category.toLowerCase()}`}
            variant="chip"
            onClick={`filter-${category.toLowerCase()}`}
            layout={{ padding: "{space.2}", justify: "center", align: "center" }}
          >
            <Text style={{ color: "{color.text}", fontSize: 14 }}>{category}</Text>
          </Button>
        ))}
      </ScrollView>

      {/* Vertical scroller: the bound catalogue plus the rare section in a 340 px
          viewport. `align: "stretch"` makes the rows take the full content width
          — the scrollable axis is unconstrained, the cross axis is not. */}
      <ScrollView
        id="catalogue"
        layout={{
          width: 460,
          height: 340,
          padding: "{space.2}",
          gap: "{space.1}",
          align: "stretch",
        }}
        style={{
          background: "{color.bg.panel}",
          radius: "{radius.md}",
          borderWidth: 1,
          borderColor: "{color.border}",
        }}
      >
        {/* The whole catalogue: one template, one array. `as="it"` moves every
            binding at once if the alias is ever renamed. */}
        <List
          items="shop.items"
          as="it"
          keyPath="id"
          layout={{ gap: "{space.1}", align: "stretch" }}
          empty={
            <Container layout={{ height: 64, justify: "center", align: "center" }}>
              <Text style={DETAIL}>The shop is empty — push `shop.items`</Text>
            </Container>
          }
        >
          {(it) => (
            <Row layout={ROW_LAYOUT} style={ROW}>
              <Container
                layout={{ width: 40, height: 40, justify: "center", align: "center" }}
                style={{ background: "{color.bg.row.alt}", radius: "{radius.md}" }}
              >
                <Text bind={it("tag")} style={{ color: "{color.text}", fontSize: 15 }} />
              </Container>

              <Column layout={{ grow: 1, gap: "{space.1}" }}>
                <Text bind={it("name")} style={NAME} />
                <Text bind={it("detail")} style={DETAIL} />
              </Column>

              <Row layout={{ gap: "{space.1}", align: "center" }}>
                <Text bind={it("price")} style={PRICE} />
                <Text style={PRICE}>gold</Text>
              </Row>

              {/* Two-way, into the element: tapping it writes `shop.items.<n>.fav`
                  and the game hears it on `onDataChanged`. */}
              <Checkbox checked={{ bind: it("fav") }} onChange="favourite" size={20} />

              <Button
                variant="buy"
                onClick="buy"
                layout={{ padding: "{space.2}", justify: "center", align: "center" }}
              >
                <Text style={{ color: "{color.text}", fontSize: 14 }}>Buy</Text>
              </Button>
            </Row>
          )}
        </List>

        {/* children[0] is the header (always visible, tapping toggles); closing
            it drops three rows of content and the offset re-clamps. */}
        <Collapse id="rare-section" layout={{ gap: "{space.1}", align: "stretch" }}>
          <Row
            layout={{ height: 44, padding: "{space.2}", justify: "space-between", align: "center" }}
            style={{ background: "{color.bg.row.alt}", radius: "{radius.md}" }}
          >
            <Text style={NAME}>Rare items</Text>
            <Text style={DETAIL}>{`${RARE.length} pieces`}</Text>
          </Row>
          {RARE.map((item) => (
            <RareRow key={item[0]} item={item} />
          ))}
        </Collapse>
      </ScrollView>

      <Text style={{ color: "{color.text.muted}", fontSize: 14 }}>
        Push `shop.items` from the data panel or the console · wheel or drag inside the list
      </Text>
    </Column>
  );
}
