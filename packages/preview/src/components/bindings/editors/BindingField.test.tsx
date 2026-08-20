/**
 * The field, against the real store — because what this is FOR is the round
 * trip: the editor writes a typed value in, a control on the canvas writes one
 * back, and the field has to show that it happened without taking the text out
 * from under whoever is typing.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Binding, BindingType } from "@/store";
import { useStore } from "@/store";
import { BindingField, UI_MARK_MS } from "./BindingField";

interface Seed {
  path: string;
  type: BindingType;
  value?: unknown;
}

function seed(...bindings: Seed[]): void {
  const byPath = Object.fromEntries(
    bindings.map(({ path, type, value }): [string, Binding] => [
      path,
      { path, type, value, lastWriteFrom: null, writtenAt: null },
    ]),
  );
  act(() => {
    useStore.setState({ bindings: { byPath, order: bindings.map(({ path }) => path) } });
  });
}

/** What V14 will do: read the path off the store and hand the field its binding. */
function Field({ path, disabled }: { path: string; disabled?: boolean }) {
  const binding = useStore((state) => state.bindings.byPath[path]);
  return binding === undefined ? null : <BindingField binding={binding} disabled={disabled} />;
}

const stored = (path: string): unknown => useStore.getState().bindings.byPath[path]?.value;

beforeEach(() => {
  useStore.setState({ bindings: { byPath: {}, order: [] } });
});

describe("BindingField", () => {
  it("gives a boolean a switch, and writes a real boolean", async () => {
    const user = userEvent.setup();
    seed({ path: "settings.music", type: "boolean", value: false });
    render(<Field path="settings.music" />);

    const control = screen.getByRole("switch", { name: "settings.music" });
    expect(control).not.toBeChecked();

    await user.click(control);

    expect(stored("settings.music")).toBe(true);
    expect(screen.getByRole("switch", { name: "settings.music" })).toBeChecked();
  });

  it("gives a number a stepper, and writes a real number", async () => {
    const user = userEvent.setup();
    seed({ path: "player.gold", type: "number", value: 1250 });
    render(<Field path="player.gold" />);

    const control = screen.getByRole("spinbutton", { name: "player.gold" });

    await user.click(screen.getByRole("button", { name: "Increase" }));
    expect(stored("player.gold")).toBe(1251);

    await user.click(control);
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(stored("player.gold")).toBe(1261);

    await user.clear(control);
    await user.type(control, "80");
    expect(stored("player.gold")).toBe(80);
  });

  it("gives a string a plain input, and does not turn digits into a number", async () => {
    const user = userEvent.setup();
    seed({ path: "player.name", type: "string", value: "Aria" });
    render(<Field path="player.name" />);

    const control = screen.getByRole("textbox", { name: "player.name" });
    expect(control).toHaveValue("Aria");

    await user.clear(control);
    await user.type(control, "42");

    expect(stored("player.name")).toBe("42");
  });

  it("shows a non-numeric value in a number field as it stands, tag and all", () => {
    // `SetData` from the game with a string, into a path the envelope types as a
    // number. The panel reports what the game did instead of showing NaN.
    seed({ path: "settings.volume", type: "number", value: "loud" });
    render(<Field path="settings.volume" />);

    expect(screen.getByRole("textbox", { name: "settings.volume" })).toHaveValue("loud");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getByText("number")).toBeInTheDocument();
  });

  it("gives an array the JSON editor, and writes the parsed value", async () => {
    const user = userEvent.setup();
    seed({ path: "shop.items", type: "array", value: [{ id: "sword", price: 320 }] });
    render(<Field path="shop.items" />);

    expect(screen.getByText("array(1)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit JSON" }));
    const area = screen.getByRole("textbox", { name: "shop.items" });
    await user.clear(area);
    // Pasted rather than typed: `{` and `[` are userEvent's own syntax.
    await user.paste('[{"id":"map","price":95}]');
    await user.tab();

    expect(stored("shop.items")).toEqual([{ id: "map", price: 95 }]);
  });

  it("names its control and describes it with the type tag", () => {
    seed({ path: "player.gold", type: "number", value: 1250 });
    render(<Field path="player.gold" />);

    expect(screen.getByRole("spinbutton", { name: "player.gold" })).toHaveAccessibleDescription(
      "number",
    );
  });

  it("holds values but stops editing them when the panel is disabled", () => {
    seed({ path: "settings.music", type: "boolean", value: true });
    render(<Field path="settings.music" disabled />);

    const control = screen.getByRole("switch", { name: "settings.music" });
    expect(control).toBeChecked();
    expect(control).toBeDisabled();
  });
});

describe("the ← UI mark", () => {
  it("goes up when the canvas writes, and swaps the type tag for the chip", () => {
    seed({ path: "settings.sfx", type: "boolean", value: false });
    const { container } = render(<Field path="settings.sfx" />);

    expect(screen.queryByText("← UI")).not.toBeInTheDocument();

    act(() => useStore.getState().setFromUI("settings.sfx", true));

    expect(screen.getByText("← UI")).toBeInTheDocument();
    expect(container.querySelector("[data-ui-mark]")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "settings.sfx" })).toBeChecked();
    // The tag stops being drawn; it does not stop being the description.
    expect(screen.getByText("boolean")).toHaveClass("sr-only");
  });

  it("clears itself four seconds after the write", () => {
    vi.useFakeTimers();
    try {
      seed({ path: "settings.sfx", type: "boolean", value: false });
      render(<Field path="settings.sfx" />);

      act(() => useStore.getState().setFromUI("settings.sfx", true));
      act(() => vi.advanceTimersByTime(UI_MARK_MS - 1));
      expect(screen.getByText("← UI")).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByText("← UI")).not.toBeInTheDocument();
      expect(screen.getByText("boolean")).not.toHaveClass("sr-only");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears on the next edit of the field's own", async () => {
    const user = userEvent.setup();
    seed({ path: "settings.sfx", type: "boolean", value: false });
    render(<Field path="settings.sfx" />);

    act(() => useStore.getState().setFromUI("settings.sfx", true));
    expect(screen.getByText("← UI")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "settings.sfx" }));

    expect(screen.queryByText("← UI")).not.toBeInTheDocument();
    expect(stored("settings.sfx")).toBe(false);
  });

  it("does not overwrite or steal a field that is being typed in", async () => {
    const user = userEvent.setup();
    seed({ path: "player.name", type: "string", value: "" });
    render(<Field path="player.name" />);

    const control = screen.getByRole("textbox", { name: "player.name" });
    await user.click(control);
    await user.type(control, "Ari");

    act(() => useStore.getState().setFromUI("player.name", "Zed"));

    // The mark is up — the write DID happen — but the text and the caret are the
    // person's until they leave.
    expect(screen.getByText("← UI")).toBeInTheDocument();
    expect(control).toHaveValue("Ari");
    expect(control).toHaveFocus();

    await user.tab();

    expect(control).toHaveValue("Zed");
  });
});
