// User components run at AUTHORING time and never reach the IR — they execute
// during `zabloo export` and emit zabloo primitives. In the game, push live
// data with `document.SetData("player.gold", value)` (C#) and the bound Text
// below updates and relayouts.
import { Row, Text } from "@zabloo/react";

export function GoldRow() {
  return (
    <Row layout={{ gap: 8 }}>
      <Text style={{ color: "{color.gold}", fontSize: 20 }}>Gold:</Text>
      <Text bind="player.gold" style={{ color: "{color.gold}", fontSize: 20 }} />
    </Row>
  );
}
