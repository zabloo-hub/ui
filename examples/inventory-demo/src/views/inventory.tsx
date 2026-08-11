// View "inventory" (file-based convention: the filename is the view ID).
// Reference screen for <ScrollView> (ZAB-9): a shop whose content overflows for
// real, and the base the F6 list example grows from (today the rows are built at
// authoring time with a map; F6 replaces that map with a bound `Repeat`).
//
// What each block is here to prove:
//  - The category strip scrolls on the OTHER axis (`axis="horizontal"`) with the
//    indicator off (`scrollbar={false}`), and its chips never wrap: a ScrollView
//    offers no width on a scrollable axis, so children measure unconstrained.
//  - The catalogue is a vertical ScrollView with rich rows — icon, name, detail,
//    price and a "Buy" Button. The Button proves drag-to-scroll does not eat the
//    click on interactive content nested inside the scroller.
//  - The "rare items" <Collapse> lives INSIDE the scroller: closing it shrinks
//    the content, and the offset is re-clamped to the new maximum on the relayout
//    instead of leaving the list scrolled past its end.
//  - Nothing paints or is tappable outside the panel: a ScrollView always clips
//    (paint AND hit-testing), and an explicit `clip: false` would be ignored.
import { Button, Collapse, Column, Container, Row, ScrollView, Text } from "@zabloo/react";

/**
 * One shop entry, as a tuple so the catalogue below reads as a table:
 * `[id, name, detail, price in gold, icon tag, icon color]`. The tag is two
 * letters standing in for the icon art — the repo ships no image assets yet.
 */
type Item = [string, string, string, number, string, string];

const CATEGORIES = [
  "Todo",
  "Armas",
  "Armaduras",
  "Pociones",
  "Materiales",
  "Hechizos",
  "Monturas",
  "Cosméticos",
];

const STOCK: Item[] = [
  ["espada", "Espada de hierro", "Daño 12 · Peso 4", 120, "ES", "#3f4a63"],
  ["hacha", "Hacha de guerra", "Daño 18 · Peso 9", 260, "HA", "#4a3f63"],
  ["arco", "Arco corto", "Daño 9 · Alcance 30", 180, "AR", "#3f6357"],
  ["daga", "Daga rápida", "Daño 6 · Crítico +15%", 95, "DA", "#63523f"],
  ["escudo", "Escudo de roble", "Bloqueo 22 · Peso 7", 140, "EC", "#3f5563"],
  ["yelmo", "Yelmo abollado", "Defensa 5 · Peso 2", 60, "YE", "#544a3f"],
  ["coraza", "Coraza de placas", "Defensa 24 · Peso 15", 420, "CO", "#3f4a63"],
  ["botas", "Botas de viajero", "Defensa 3 · Vel. +10%", 75, "BO", "#4a633f"],
  ["pocion", "Poción de vida", "Cura 50 PV", 25, "PV", "#633f4a"],
  ["mana", "Poción de maná", "Restaura 40 PM", 30, "PM", "#3f4763"],
  ["antidoto", "Antídoto", "Cura veneno", 18, "AN", "#3f6349"],
  ["cuerda", "Cuerda resistente", "Material · 10 m", 12, "CU", "#5a5342"],
  ["lingote", "Lingote de acero", "Material de forja", 45, "LI", "#4a4a4a"],
  ["pergamino", "Pergamino en blanco", "Material de escriba", 22, "PE", "#5a4a3f"],
];

const RARE: Item[] = [
  ["reliquia", "Reliquia del alba", "Único · Luz sagrada", 1500, "RE", "#63563f"],
  ["grimorio", "Grimorio prohibido", "Único · Hechizos oscuros", 1200, "GR", "#4a3f5e"],
  ["corona", "Corona del rey caído", "Único · Mando +2", 2400, "CR", "#63603f"],
];

const NAME = { color: "{color.text}", fontSize: 16 } as const;
const DETAIL = { color: "{color.text.muted}", fontSize: 13 } as const;
const PRICE = { color: "{color.gold}", fontSize: 15 } as const;

/** One catalogue row. Rich enough to be the F6 item template, minus the binding. */
function ItemRow({ item, index }: { item: Item; index: number }) {
  const [id, name, detail, price, tag, color] = item;
  return (
    <Row
      layout={{ height: 64, padding: "{space.2}", gap: "{space.2}", align: "center" }}
      style={{
        background: index % 2 === 0 ? "{color.bg.row}" : "{color.bg.row.alt}",
        radius: "{radius.md}",
      }}
    >
      <Container
        layout={{ width: 40, height: 40, justify: "center", align: "center" }}
        style={{ background: color, radius: "{radius.md}" }}
      >
        <Text style={{ color: "{color.text}", fontSize: 15 }}>{tag}</Text>
      </Container>

      <Column layout={{ grow: 1, gap: "{space.1}" }}>
        <Text style={NAME}>{name}</Text>
        <Text style={DETAIL}>{detail}</Text>
      </Column>

      <Text style={PRICE}>{`${price} oro`}</Text>

      <Button
        id={`buy-${id}`}
        variant="buy"
        onClick={`buy-${id}`}
        layout={{ padding: "{space.2}", justify: "center", align: "center" }}
      >
        <Text style={{ color: "{color.text}", fontSize: 14 }}>Comprar</Text>
      </Button>
    </Row>
  );
}

export default function Inventory() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: "{space.4}" }}>
      <Row layout={{ width: 460, justify: "space-between", align: "center" }}>
        <Text style={{ color: "{color.text}", fontSize: 20 }}>Tienda del gremio</Text>
        {/* Bound, like any other text: the preview's data panel (or the game's
            SetData) fills it — it is empty until someone sets `player.gold`. */}
        <Row layout={{ gap: "{space.1}", align: "center" }}>
          <Text style={PRICE}>Oro:</Text>
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

      {/* Vertical scroller: 14 rows plus the rare section in a 340 px viewport.
          `align: "stretch"` makes the rows take the full content width — the
          scrollable axis is unconstrained, the cross axis is not. */}
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
        {STOCK.map((item, index) => (
          <ItemRow key={item[0]} item={item} index={index} />
        ))}

        {/* children[0] is the header (always visible, tapping toggles); closing
            it drops three rows of content and the offset re-clamps. */}
        <Collapse id="rare-section" layout={{ gap: "{space.1}", align: "stretch" }}>
          <Row
            layout={{ height: 44, padding: "{space.2}", justify: "space-between", align: "center" }}
            style={{ background: "{color.bg.row.alt}", radius: "{radius.md}" }}
          >
            <Text style={NAME}>Objetos raros</Text>
            <Text style={DETAIL}>{`${RARE.length} piezas`}</Text>
          </Row>
          {RARE.map((item, index) => (
            <ItemRow key={item[0]} item={item} index={index} />
          ))}
        </Collapse>
      </ScrollView>

      <Text style={{ color: "{color.text.muted}", fontSize: 14 }}>
        Rueda o arrastra en la lista · la tira de categorías pide gesto horizontal
      </Text>
    </Column>
  );
}
