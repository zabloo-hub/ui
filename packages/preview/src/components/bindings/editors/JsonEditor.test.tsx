/**
 * The array/object editor on its own, where the interesting cases are: JSON that
 * does not parse yet, and the three ways out of an edit.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JsonEditor } from "./JsonEditor";

const ITEMS = [
  { id: "sword", price: 320 },
  { id: "map", price: 95 },
];

function setup(value: unknown = ITEMS) {
  const onCommit = vi.fn();
  const user = userEvent.setup();
  render(
    <JsonEditor
      id="items"
      path="shop.items"
      value={value}
      describedBy="items-type"
      onCommit={onCommit}
      label={
        <>
          <span>shop.items</span>
          <span id="items-type">array(2)</span>
        </>
      }
    />,
  );
  return { onCommit, user };
}

/** Enters the edit mode and hands back the textarea. */
async function edit(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: "Edit JSON" }));
  return screen.getByRole("textbox", { name: "shop.items" });
}

describe("JsonEditor", () => {
  it("shows the value pretty-printed, open, as artboard 1a draws it", () => {
    setup();

    // Not `toHaveTextContent`: the indent is the assertion, and that normalizes it.
    expect(screen.getByText(/"sword"/).textContent).toBe(JSON.stringify(ITEMS, null, 2));
  });

  it("collapses and reopens from its header", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: /shop\.items/ }));
    expect(screen.queryByText(/"sword"/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /shop\.items/ }));
    expect(screen.getByText(/"sword"/)).toBeInTheDocument();
  });

  it("hands the code over to a textarea, focused, on Edit JSON", async () => {
    const { user } = setup();

    const area = await edit(user);

    expect(area).toHaveFocus();
    expect(area).toHaveValue(JSON.stringify(ITEMS, null, 2));
    expect(area).toHaveAccessibleDescription("array(2)");
  });

  it("writes at blur, once", async () => {
    const { user, onCommit } = setup();

    const area = await edit(user);
    await user.clear(area);
    await user.paste('[{"id":"tonic","price":40}]');
    await user.tab();

    expect(onCommit).toHaveBeenCalledExactlyOnceWith('[{"id":"tonic","price":40}]');
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("writes on Cmd/Ctrl+Enter without waiting for the blur", async () => {
    const { user, onCommit } = setup();

    const area = await edit(user);
    await user.clear(area);
    await user.paste("[]");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(onCommit).toHaveBeenCalledExactlyOnceWith("[]");
  });

  it("marks JSON that does not parse and writes nothing — and keeps the text", async () => {
    const { user, onCommit } = setup();

    const area = await edit(user);
    await user.clear(area);
    await user.paste('[{"id":"tonic",');

    expect(area).toHaveAttribute("aria-invalid", "true");

    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
    // Half an array is not an error to shout about, and it is not one to throw
    // away either: the edit survives the blur so the bracket can be found.
    expect(screen.getByRole("textbox", { name: "shop.items" })).toHaveValue('[{"id":"tonic",');
  });

  it("cancels on Esc", async () => {
    const { user, onCommit } = setup();

    const area = await edit(user);
    await user.clear(area);
    await user.paste("[]");
    await user.keyboard("{Escape}");

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/"sword"/)).toBeInTheDocument();
  });

  it("prints text a coerce left behind as it stands, not re-quoted", () => {
    setup('[{"id":"sword"');

    expect(screen.getByText('[{"id":"sword"')).toBeInTheDocument();
  });

  it("stops editing when the panel is disabled", () => {
    const onCommit = vi.fn();
    render(
      <JsonEditor
        id="items"
        path="shop.items"
        value={ITEMS}
        disabled
        describedBy="items-type"
        onCommit={onCommit}
        label={<span>shop.items</span>}
      />,
    );

    expect(screen.getByRole("button", { name: "Edit JSON" })).toBeDisabled();
  });
});
