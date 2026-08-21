/**
 * The two tables that say the same thing in three places: the dot's colour and
 * the word, per connection state.
 *
 * They landed three times over — `Statusbar`, `ZenPill` and `ConnectionPill` each
 * grew their own copy while V13, V15 and V7 were built in parallel — and three
 * copies of a `Record<ConnectionState, …>` is three chances for a `Live` pill to
 * end up wearing an amber dot. One module, one table each.
 *
 * The colours are set as `--badge-dot` on the CONTAINER rather than passed to
 * {@link BadgeDot}, which reads that variable: the pairing then belongs to the
 * state and not to whoever remembered to pass the right prop (see `ui/badge.tsx`).
 */

import type { ConnectionState } from "@/store";

/** The three states, on the tokens the connection badges already use. */
const CONNECTION_DOT: Record<ConnectionState, string> = {
  live: "[--badge-dot:var(--ok)]",
  stale: "[--badge-dot:var(--warn)]",
  disconnected: "[--badge-dot:var(--danger)]",
};

/** The word for each state. `stale` is the one that has to be read to be useful. */
const CONNECTION_LABEL: Record<ConnectionState, string> = {
  live: "Live",
  stale: "Stale",
  disconnected: "Disconnected",
};

export { CONNECTION_DOT, CONNECTION_LABEL };
