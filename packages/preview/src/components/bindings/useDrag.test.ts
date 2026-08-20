/**
 * The clamp on its own. It is the one piece of the drag that is arithmetic
 * rather than DOM, and the case worth pinning is the last one: a stage smaller
 * than the card has no legal position, and the answer has to be a corner you can
 * still reach rather than a negative offset that puts the grip off-screen.
 */

import { clamp } from "./useDrag";

const CARD = { width: 296, height: 400 };
const STAGE = { width: 1000, height: 600 };

describe("clamp", () => {
  it("leaves a position that is already inside alone", () => {
    expect(clamp({ x: 120, y: 80 }, CARD, STAGE)).toEqual({ x: 120, y: 80 });
  });

  it("holds the card at the top-left corner", () => {
    expect(clamp({ x: -40, y: -10 }, CARD, STAGE)).toEqual({ x: 0, y: 0 });
  });

  it("holds the card at the bottom-right corner", () => {
    expect(clamp({ x: 9000, y: 9000 }, CARD, STAGE)).toEqual({ x: 704, y: 200 });
  });

  it("clamps each axis on its own", () => {
    expect(clamp({ x: 9000, y: 80 }, CARD, STAGE)).toEqual({ x: 704, y: 80 });
  });

  it("pins the card to the origin when the stage is smaller than it is", () => {
    expect(clamp({ x: 50, y: 50 }, CARD, { width: 200, height: 200 })).toEqual({ x: 0, y: 0 });
  });
});
