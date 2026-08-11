/**
 * The renderer's data store — the game's half of the data channel, addressed by
 * PATH instead of by opaque key (decision 2026-08-11, ZAB-29).
 *
 * Until F6 a bound path WAS the key: `setData("player.gold", 900)` and
 * `{bind: "player.gold"}` met in a flat map. Array bindings break that, because a
 * template resolves `{bind: "item.name"}` into `"shop.items.3.name"` — an address
 * INTO the value the game pushed under `"shop.items"`, which nobody will ever
 * write under its own key. So a read walks down from the longest prefix that was
 * actually written and finishes with `readPath` (the normative reader, so every
 * SDK resolves the same segments the same way).
 *
 * **A deeper write shadows the value it was made into.** A Toggle inside a row
 * writes `"shop.items.3.enabled"`, and the array under `"shop.items"` is the
 * game's own object — the renderer does not mutate it. Reading the deep path
 * finds the deep key first, so the control keeps the value it wrote; reading the
 * whole array still gives the game's data. That is the honest split: the write
 * already travelled out through `onDataChanged`, and the game owns the truth.
 * Which is also why writing a path DROPS everything under it: a fresh array
 * arriving on `"shop.items"` must not keep the old row 3 alive underneath.
 */

import { readPath } from "@zabloo/format";

export class DataStore {
  private readonly values = new Map<string, unknown>();

  /**
   * Writes a value at `path`. Descendants are dropped: whatever was written
   * under this path described the value being replaced, not the new one.
   */
  set(path: string, value: unknown): void {
    const prefix = `${path}.`;
    for (const key of this.values.keys()) {
      if (key.startsWith(prefix)) this.values.delete(key);
    }
    this.values.set(path, value);
  }

  /**
   * Reads a path: the longest written prefix wins, and the rest of the segments
   * are walked inside its value. Missing is `undefined` all the way down — bound
   * UI degrades to "no value", it never breaks the frame.
   */
  get(path: string): unknown {
    if (path.length === 0) return undefined;
    let cut = path.length;
    while (cut > 0) {
      const head = path.slice(0, cut);
      if (this.values.has(head)) {
        const value = this.values.get(head);
        return cut === path.length ? value : readPath(value, path.slice(cut + 1));
      }
      cut = path.lastIndexOf(".", cut - 1);
    }
    return undefined;
  }

  clear(): void {
    this.values.clear();
  }
}

/**
 * Whether writing `written` changes what a binding on `bound` reads. Both
 * directions count: a new `"shop.items"` moves every `"shop.items.3.name"` in the
 * tree, and a write to `"shop.items.3.enabled"` moves a binding watching the
 * whole array. Unrelated siblings (`"shop.itemsCount"`) never match — the
 * separator is part of the comparison.
 */
export function affects(written: string, bound: string): boolean {
  return written === bound || bound.startsWith(`${written}.`) || written.startsWith(`${bound}.`);
}
