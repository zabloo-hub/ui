/**
 * The scenario the chrome half of the page is showing, and the seed behind it.
 *
 * **The seal is taken while the page RENDERS, not in an effect**, and that is the
 * whole reason this hook exists rather than two `useEffect`s in `Kit`. Effects run
 * child-first: by the time a parent's effect fires, every specimen below it has
 * already mounted and some of them have already written — the stage registers its
 * canvas, the statusbar starts its clock — and each of those writes takes the
 * persist middleware with it. A seal in an effect would therefore be a seal taken
 * after the first writes had gone to the disk. A lazy `useState` initializer runs
 * before Kit returns its tree, so nothing below it has even rendered yet.
 *
 * It is a side effect during render, which is normally a smell; it is safe here
 * for the two reasons that make it safe anywhere — it is idempotent (StrictMode
 * runs the initializer twice), and it touches nothing React is rendering.
 *
 * The seed stays in a layout effect, where a store write belongs. Between the two
 * there is one pass in which the specimens read the tool's own state, and the
 * layout effect lands the fixture before the browser is allowed to paint — the
 * same reason `TokensCell` reads its palette in one.
 */

import { useLayoutEffect, useState } from "react";
import { type Scenario, sealStore, seedFixture } from "@/kit/fixture";

interface KitFixture {
  scenario: Scenario;
  select: (scenario: Scenario) => void;
}

function useKitFixture(): KitFixture {
  const [scenario, select] = useState<Scenario>(() => {
    sealStore();
    return "stale";
  });

  useLayoutEffect(() => {
    seedFixture(scenario);
  }, [scenario]);

  return { scenario, select };
}

export type { KitFixture };
export { useKitFixture };
