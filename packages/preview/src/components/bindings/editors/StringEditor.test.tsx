/**
 * The mono text field, on its own.
 *
 * Two decisions live here and nowhere else: an undeclared value shows as an
 * EMPTY field rather than the word "undefined", and the field writes on every
 * keystroke rather than on blur — this panel plays the game, and a game pushes a
 * value the moment it has one.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StringEditor } from "./StringEditor";

const props = {
  id: "name",
  path: "player.name",
  describedBy: "name-type",
  onCommit: () => {},
};

const field = () => screen.getByRole("textbox");

describe("StringEditor", () => {
  it("shows the text it was given", () => {
    render(<StringEditor {...props} value="Aria" />);

    expect(field()).toHaveValue("Aria");
  });

  /** A path declared and never written holds `undefined`; an empty box says that better. */
  it("leaves a path with no value yet blank", () => {
    render(<StringEditor {...props} value={undefined} />);

    expect(field()).toHaveValue("");
  });

  /** The type comes from the binding site; the game can put anything in it. */
  it("shows a value that is not a string as the bridge formats it", () => {
    render(<StringEditor {...props} value={42} />);

    expect(field()).toHaveValue("42");
  });

  it("writes on every keystroke, not on the way out", async () => {
    const committed: unknown[] = [];
    const user = userEvent.setup();
    render(<StringEditor {...props} value="" onCommit={(raw) => committed.push(raw)} />);

    await user.type(field(), "Ar");

    // Uncontrolled by this component: the field is told what to show, so each
    // keystroke lands on the same empty value. What matters is that both wrote.
    expect(committed).toEqual(["A", "r"]);
  });

  it("holds the value but refuses the edit when the panel is disabled", async () => {
    const committed: unknown[] = [];
    const user = userEvent.setup();
    render(
      <StringEditor {...props} value="Aria" disabled onCommit={(raw) => committed.push(raw)} />,
    );

    await user.type(field(), "x");

    expect(field()).toBeDisabled();
    expect(field()).toHaveValue("Aria");
    expect(committed).toEqual([]);
  });

  it("answers to the field's label and its type tag", () => {
    render(<StringEditor {...props} value="Aria" />);

    expect(field()).toHaveAttribute("id", "name");
    expect(field()).toHaveAttribute("aria-describedby", "name-type");
  });
});
