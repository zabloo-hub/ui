import { AppShell } from "@/components/layout/AppShell";
import { useThemeClass } from "@/components/layout/useThemeClass";
import { useZenShortcuts } from "@/components/zen/useZenShortcuts";
import { useSession } from "@/session";

/**
 * The app: the dev loop, the two effects that reach outside React — the theme
 * onto `<html>`, Escape onto `window` — and the shell that draws everything else.
 *
 * It stays this thin on purpose. Anything that is a piece of the chrome belongs
 * in a region, anything that is a rule of the chrome belongs in a hook, and what
 * is left here is the list of them, which is the only thing several tickets need
 * to touch at once.
 *
 * `useSession()` is first and is not layout at all: the whole dev loop — the
 * stream, the loads, the mounted view — hangs off that single call, mounted here
 * because it must outlive every region below it (V6).
 */
function App() {
  useSession();
  useThemeClass();
  useZenShortcuts();

  return <AppShell />;
}

export { App };
