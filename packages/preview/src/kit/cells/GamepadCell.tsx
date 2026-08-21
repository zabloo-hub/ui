import { GamepadIndicator } from "@/components/statusbar/GamepadIndicator";
import { KitCaption, KitCell, KitSpecimen } from "@/kit/KitCell";

/**
 * The gamepad icon of the statusbar, and its hint.
 *
 * It shows the faint state, and it will go on showing it until you press a button
 * on a pad — which is not the specimen failing. A page is not told about a gamepad
 * until the first press on it, because a list of attached hardware is a
 * fingerprint (ZAB-47), so the off state means "none has spoken yet" rather than
 * "none is there". Lighting it up here would take a synthetic `gamepadconnected`,
 * i.e. mounting the mechanism this page exists not to mount. The indigo half of
 * the pair is drawn in `BadgesCell`, where it is what it really is: a colour on an
 * icon.
 *
 * Live: the tooltip is the state worth having, and the button writes nothing.
 */
function GamepadCell() {
  return (
    <KitCell id="gamepad" label="Gamepad indicator">
      <KitSpecimen className="flex items-center bg-card p-3">
        <GamepadIndicator />
      </KitSpecimen>
      <KitCaption>idle until a pad speaks · hover or focus for the hint</KitCaption>
    </KitCell>
  );
}

export { GamepadCell };
