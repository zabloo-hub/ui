import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

describe("Collapsible", () => {
  it("opens and closes, and says which it is", async () => {
    const user = userEvent.setup();
    render(
      <Collapsible>
        <CollapsibleTrigger>shop.items</CollapsibleTrigger>
        <CollapsibleContent>{'[{ "id": 1 }]'}</CollapsibleContent>
      </Collapsible>,
    );

    const trigger = screen.getByRole("button", { name: "shop.items" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText('[{ "id": 1 }]')).not.toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText('[{ "id": 1 }]')).toBeInTheDocument();
  });
});
