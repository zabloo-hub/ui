import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** The bottom console: Actions / Problems / Stats, with a fatal on Problems. */
function ConsoleTabs() {
  return (
    <Tabs defaultValue="actions">
      <TabsList>
        <TabsTrigger value="actions">Actions</TabsTrigger>
        <TabsTrigger value="problems">
          Problems
          <Badge variant="count">1</Badge>
        </TabsTrigger>
        <TabsTrigger value="stats">Stats</TabsTrigger>
      </TabsList>
      <TabsContent value="actions">log</TabsContent>
      <TabsContent value="problems">diagnostics</TabsContent>
      <TabsContent value="stats">frame cost</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("is a pill track with a raised card on the active tab", () => {
    render(<ConsoleTabs />);

    expect(screen.getByRole("tablist")).toHaveClass("bg-muted", "rounded-[8px]", "p-[3px]");
    expect(screen.getByRole("tab", { name: "Actions" })).toHaveClass(
      "data-active:bg-card",
      "data-active:shadow-[var(--shadow-tab)]",
    );
  });

  it("does not stretch its triggers across the header", () => {
    render(<ConsoleTabs />);

    // shadcn's `flex-1` would push the Clear button off a 34px console header.
    expect(screen.getByRole("tab", { name: "Actions" })).toHaveClass("w-fit");
  });

  it("takes a count badge in a trigger", () => {
    render(<ConsoleTabs />);

    const problems = screen.getByRole("tab", { name: /Problems/ });
    expect(problems).toHaveClass("gap-[6px]");
    expect(problems.querySelector('[data-variant="count"]')).toHaveTextContent("1");
  });

  it("shows one panel at a time and moves with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<ConsoleTabs />);

    expect(screen.getByRole("tabpanel")).toHaveTextContent("log");

    await user.tab();
    expect(screen.getByRole("tab", { name: "Actions" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Problems/, selected: true })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("diagnostics");
  });
});
