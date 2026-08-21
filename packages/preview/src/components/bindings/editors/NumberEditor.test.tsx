/**
 * The editor with a decision in it: which of two controls is on screen.
 *
 * A path the envelope types as a number does not have to HOLD one — the type
 * comes from the binding site and the game can `SetData` anything into it — so a
 * string gets a plain field and the type tag does not change. The panel reports
 * what the game did rather than hiding it behind a `NaN`.
 *
 * The half that cannot be seen from `BindingField` is WHEN that decision is
 * re-taken: only while nobody is typing in the control. Editing `"eighty"` into
 * `"80"` makes the value numeric at the first digit, and swapping there would
 * pull the field out from under the cursor and eat the rest of the word. So the
 * tests below drive the round trip the field would make — commit, coerce, feed
 * back — through a harness, because a single render can never show it.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { coerceTyped } from "@/bridge";
import { NumberEditor } from "./NumberEditor";

const props = {
  id: "gold",
  path: "player.gold",
  describedBy: "gold-type",
  onCommit: () => {},
};

const stepper = () => screen.queryByRole("spinbutton");
const text = () => screen.queryByRole("textbox");

/**
 * `BindingField` in miniature: it holds the value, and what an editor commits
 * comes back through `coerceTyped` — which is exactly how a typed `"8"` turns
 * into `8` halfway through a word.
 */
function Held({ initial, seen }: { initial: unknown; seen?: unknown[] }) {
  const [value, setValue] = React.useState<unknown>(initial);

  return (
    <NumberEditor
      {...props}
      value={value}
      onCommit={(raw) => {
        const next = coerceTyped("number", raw);
        seen?.push(next);
        setValue(next);
      }}
    />
  );
}

describe("which control is on screen", () => {
  it("gives a number the stepper", () => {
    render(<NumberEditor {...props} value={1250} />);

    expect(stepper()).toHaveValue(1250);
    expect(text()).toBeNull();
  });

  /** A path with no value yet is a number waiting to happen, not a string. */
  it("gives an undeclared path the stepper too, and leaves it empty", () => {
    render(<NumberEditor {...props} value={undefined} />);

    expect(stepper()).toHaveValue(null);
    expect(stepper()).not.toHaveDisplayValue("NaN");
  });

  it("gives a value the game made a string a plain field, as it stands", () => {
    render(<NumberEditor {...props} value="loud" />);

    expect(text()).toHaveValue("loud");
    expect(stepper()).toBeNull();
  });

  it("follows the value when the game writes while nobody is in the field", () => {
    const { rerender } = render(<NumberEditor {...props} value={1250} />);

    rerender(<NumberEditor {...props} value="loud" />);
    expect(text()).toHaveValue("loud");

    rerender(<NumberEditor {...props} value={7} />);
    expect(stepper()).toHaveValue(7);
  });
});

describe("while someone is typing in it", () => {
  /**
   * The bug the `typing` ref exists for: without it the first digit makes the
   * value numeric, the control swaps under the cursor, and everything after that
   * digit is typed into a field that is no longer there.
   */
  it("does not swap the control out from under the word being typed", async () => {
    const seen: unknown[] = [];
    const user = userEvent.setup();
    render(<Held initial="eighty" seen={seen} />);

    await user.clear(text() as HTMLElement);
    await user.type(text() as HTMLElement, "80");

    expect(text()).toHaveValue("80");
    expect(stepper()).toBeNull();
    expect(seen.at(-1)).toBe(80);
  });

  it("re-takes the decision on the way out, once the word is a number", async () => {
    const user = userEvent.setup();
    render(<Held initial="eighty" />);

    await user.clear(text() as HTMLElement);
    await user.type(text() as HTMLElement, "80");
    await user.tab();

    expect(stepper()).toHaveValue(80);
    expect(text()).toBeNull();
  });

  /** A control on the canvas writing mid-edit must not take the field either. */
  it("holds the control through a write from the game, and settles after it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<NumberEditor {...props} value="eighty" />);

    await user.click(text() as HTMLElement);
    rerender(<NumberEditor {...props} value={42} />);

    expect(text()).toBeInTheDocument();
    expect(stepper()).toBeNull();

    await user.tab();

    expect(stepper()).toHaveValue(42);
  });

  /** The same rule in the other direction: the stepper is not taken either. */
  it("keeps the stepper through a write that makes the value a word", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<NumberEditor {...props} value={1250} />);

    await user.click(stepper() as HTMLElement);
    rerender(<NumberEditor {...props} value="loud" />);

    expect(stepper()).toBeInTheDocument();
    expect(text()).toBeNull();

    await user.tab();

    expect(text()).toHaveValue("loud");
  });
});

describe("what it commits", () => {
  it("steps by a real number", async () => {
    const committed: unknown[] = [];
    const user = userEvent.setup();
    render(<NumberEditor {...props} value={1250} onCommit={(raw) => committed.push(raw)} />);

    await user.click(screen.getByRole("button", { name: "Increase" }));

    expect(committed).toEqual([1251]);
  });

  it("hands a non-numeric edit back raw, for the field to coerce", async () => {
    const committed: unknown[] = [];
    const user = userEvent.setup();
    render(<NumberEditor {...props} value="" onCommit={(raw) => committed.push(raw)} />);

    await user.type(text() as HTMLElement, "e");

    expect(committed).toEqual(["e"]);
  });

  it("holds the value but refuses the edit when the panel is disabled", async () => {
    render(<NumberEditor {...props} value={1250} disabled />);

    expect(stepper()).toBeDisabled();
    expect(stepper()).toHaveValue(1250);
  });

  it("answers to the field's label and its type tag, in both controls", () => {
    const { rerender } = render(<NumberEditor {...props} value={1250} />);

    expect(stepper()).toHaveAttribute("id", "gold");
    expect(stepper()).toHaveAttribute("aria-describedby", "gold-type");

    rerender(<NumberEditor {...props} value="loud" />);

    expect(text()).toHaveAttribute("id", "gold");
    expect(text()).toHaveAttribute("aria-describedby", "gold-type");
  });
});
