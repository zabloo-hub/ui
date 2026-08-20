/**
 * The session (V6): what turns a store and a bridge into a live canvas.
 *
 * `useSession()` is the whole public surface — the chrome mounts it once at the
 * top and never talks to it again; everything else it does, it does through the
 * store. The pieces below it are exported for the tests and for V18, which will
 * hand the identity header a real name.
 */

export {
  actionLine,
  DEFAULT_ENVELOPE_NAME,
  dprOf,
  NAME_HEADER,
  problemOf,
  viewLine,
  viewOf,
  writeLine,
} from "./translate";
export { useSession } from "./useSession";
export { type Http, type HttpResponse, type SessionDeps, type Wiring, wireSession } from "./wire";
