/**
 * The one line `App` runs to make the canvas live.
 *
 * Everything it does is in `wire.ts`; what is here is the mount contract, and
 * both halves of it matter. It runs ONCE — no dependencies, and the deps it takes
 * are read at that moment — because a re-run would tear down the stream and the
 * mounted view. And it tears all of it down on unmount, which is not decoration:
 * React 19's StrictMode mounts every effect twice in development, so a wiring
 * that leaked its `EventSource` would open two of them on the first render.
 */

import { useEffect } from "react";
import { type SessionDeps, wireSession } from "./wire";

function useSession(deps: SessionDeps = {}): void {
  // The deps are the injected browser, not reactive input — see above.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mounted once by contract
  useEffect(() => {
    const wiring = wireSession(deps);
    return () => wiring.dispose();
  }, []);
}

export { useSession };
