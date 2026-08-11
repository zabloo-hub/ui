/**
 * The render-prop form of `<List>`/`<Grid>`, written the way it is documented. It
 * lives in its own JSX file because `createElement` types a function child as a
 * plain `ReactNode` — the rest of the suite drives the components through `h()`, so
 * the API a project actually writes has to be proven here.
 */

import type { RepeatNode } from "@zabloo/format";
import { describe, expect, it } from "vitest";
import { Button, Column, Grid, List, Row, renderToIR, Text } from "./index.js";

describe("<List> and <Grid> in JSX", () => {
  it("emits the shop row of the array-bindings spec, empty state included", () => {
    const ir = renderToIR(
      <List
        items="shop.items"
        as="it"
        keyPath="id"
        layout={{ gap: 8 }}
        empty={<Text>Nada por aquí</Text>}
      >
        {(it) => (
          <Row layout={{ gap: 12, align: "center" }}>
            <Text bind={it("name")} />
            <Text bind={it("price.amount")} />
            <Button onClick="buy">
              <Text>Comprar</Text>
            </Button>
          </Row>
        )}
      </List>,
    ) as RepeatNode;

    expect(ir.items).toEqual({ bind: "shop.items" });
    expect(ir.as).toBe("it");
    expect(ir.key).toBe("id");
    expect(ir.children?.[0]).toEqual({
      type: "Container",
      layout: { direction: "row", gap: 12, align: "center" },
      children: [
        { type: "Text", text: { bind: "it.name" } },
        { type: "Text", text: { bind: "it.price.amount" } },
        { type: "Button", onClick: "buy", children: [{ type: "Text", text: "Comprar" }] },
      ],
    });
    expect(ir.children?.[1]).toEqual({ type: "Text", text: "Nada por aquí" });
  });

  it("emits the same IR whether the template binds by hand or through the item ref", () => {
    const byHand = renderToIR(
      <List items="shop.items" as="it">
        <Text bind="it.name" />
      </List>,
    );
    const byRef = renderToIR(
      <List items="shop.items" as="it">
        {(it) => <Text bind={it("name")} />}
      </List>,
    );
    expect(byRef).toEqual(byHand);
  });

  it("resolves the item ref against the default alias, the bare element and the index", () => {
    const ir = renderToIR(
      <List items="players">
        {(player) => (
          <Row>
            <Text bind={player.$index} />
            <Text bind={player()} />
          </Row>
        )}
      </List>,
    ) as RepeatNode;

    // No `as` in the IR: "item" is the primitive's own default.
    expect(ir.as).toBeUndefined();
    expect(ir.children?.[0]).toEqual({
      type: "Container",
      layout: { direction: "row" },
      children: [
        { type: "Text", text: { bind: "item.$index" } },
        { type: "Text", text: { bind: "item" } },
      ],
    });
  });

  it("nests lists, and the inner template still reaches the outer element", () => {
    const ir = renderToIR(
      <List items="shop.cats" as="cat" keyPath="id">
        {(cat) => (
          <Column>
            <Text bind={cat("name")} />
            <List items={cat("items")} as="it">
              {(it) => (
                <Row>
                  <Text bind={it("name")} />
                  {/* The category's id, read from inside the product row. */}
                  <Text bind={cat("id")} />
                </Row>
              )}
            </List>
          </Column>
        )}
      </List>,
    ) as RepeatNode;

    expect(ir.children?.[0]).toEqual({
      type: "Container",
      layout: { direction: "column" },
      children: [
        { type: "Text", text: { bind: "cat.name" } },
        {
          type: "Repeat",
          items: { bind: "cat.items" },
          as: "it",
          layout: { direction: "column" },
          children: [
            {
              type: "Container",
              layout: { direction: "row" },
              children: [
                { type: "Text", text: { bind: "it.name" } },
                { type: "Text", text: { bind: "cat.id" } },
              ],
            },
          ],
        },
      ],
    });
  });

  it("flattens user components inside the template, like everywhere else", () => {
    function Price({ path }: { path: string }) {
      return <Text style={{ color: "#22c55e" }} bind={path} />;
    }
    const ir = renderToIR(
      <List items="shop.items">{(item) => <Price path={item("price")} />}</List>,
    ) as RepeatNode;
    expect(ir.children).toEqual([
      { type: "Text", style: { color: "#22c55e" }, text: { bind: "item.price" } },
    ]);
  });

  it("sizes a Grid from itemWidth so exactly `columns` cells fit per line", () => {
    const ir = renderToIR(
      <Grid items="inventory.slots" columns={4} itemWidth={72} layout={{ gap: 8 }}>
        {(slot) => <Text bind={slot("name")} />}
      </Grid>,
    ) as RepeatNode;

    // 4 * 72 + 3 * 8
    expect(ir.layout).toEqual({ direction: "row", wrap: true, gap: 8, width: 312 });
    expect(ir.children).toEqual([
      {
        type: "Container",
        layout: { width: 72 },
        children: [{ type: "Text", text: { bind: "item.name" } }],
      },
    ]);
  });
});
