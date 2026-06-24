import { Button, Label } from "@zabloo/react";

export default function App() {
  return (
    <Button
      id="buy-btn"
      variant="primary"
      onClick="buy"
      padding={{ x: "space.4", y: "space.2" }}
      background="color.primary"
      radius="radius.md"
      states={{ hover: { background: "color.primary.hover" } }}
    >
      <Label color="color.on-primary">Buy</Label>
    </Button>
  );
}
