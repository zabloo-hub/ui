import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { NumberInput } from "@/components/ui/number-input";

/** Controlled the way the bindings panel will drive it. */
function Field({ step, shiftStep, min, max }: React.ComponentProps<typeof NumberInput>) {
  const [value, setValue] = React.useState(1250);
  return (
    <NumberInput
      aria-label="player.gold"
      value={value}
      onValueChange={setValue}
      step={step}
      shiftStep={shiftStep}
      min={min}
      max={max}
    />
  );
}

describe("NumberInput", () => {
  it("is a spinbutton, and hides the native one", () => {
    render(<Field />);

    const field = screen.getByRole("spinbutton", { name: "player.gold" });
    expect(field).toHaveValue(1250);
    expect(field).toHaveClass("[appearance:textfield]");
  });

  it("steps from the buttons the design draws", async () => {
    const user = userEvent.setup();
    render(<Field />);

    await user.click(screen.getByRole("button", { name: "Increase" }));
    expect(screen.getByRole("spinbutton")).toHaveValue(1251);

    await user.click(screen.getByRole("button", { name: "Decrease" }));
    await user.click(screen.getByRole("button", { name: "Decrease" }));
    expect(screen.getByRole("spinbutton")).toHaveValue(1249);
  });

  it("steps from the arrow keys, ten at a time with Shift", async () => {
    const user = userEvent.setup();
    render(<Field />);

    const field = screen.getByRole("spinbutton");
    await user.click(field);

    await user.keyboard("{ArrowUp}");
    expect(field).toHaveValue(1251);

    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(field).toHaveValue(1261);

    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(field).toHaveValue(1251);
  });

  it("honours an explicit shiftStep and step", async () => {
    const user = userEvent.setup();
    render(<Field step={5} shiftStep={100} />);

    const field = screen.getByRole("spinbutton");
    await user.click(field);

    await user.keyboard("{ArrowUp}");
    expect(field).toHaveValue(1255);

    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(field).toHaveValue(1355);
  });

  it("clamps a step to the range, but lets typing run free until blur", async () => {
    const user = userEvent.setup();
    render(<Field min={0} max={1251} />);

    const field = screen.getByRole("spinbutton");
    await user.click(field);
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(field).toHaveValue(1251);

    await user.clear(field);
    await user.type(field, "9000");
    expect(field).toHaveValue(9000);

    await user.tab();
    expect(field).toHaveValue(1251);
  });

  it("does not surface floating point noise", async () => {
    const user = userEvent.setup();
    render(<Field step={0.1} />);

    await user.click(screen.getByRole("spinbutton"));
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(screen.getByRole("spinbutton")).toHaveValue(1250.3);
  });

  it("keeps the steppers out of the tab order", async () => {
    const user = userEvent.setup();
    render(<Field />);

    await user.tab();
    expect(screen.getByRole("spinbutton")).toHaveFocus();

    // The field is already a spinbutton; two more tab stops per binding is noise.
    await user.tab();
    expect(screen.getByRole("spinbutton")).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "Increase" })).not.toHaveFocus();
  });
});
