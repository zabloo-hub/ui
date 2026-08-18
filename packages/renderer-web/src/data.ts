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
   * Keys written UNDER each ancestor path — the index that makes dropping
   * descendants a lookup instead of a scan (ZAB-73).
   *
   * Without it every `setData` walked every key in the store to find the few
   * that hang off the path being written, so a game pushing a value per frame
   * paid for the whole store on each push. A key registers under each of its
   * ancestor prefixes, which is a handful of entries (paths are short), and the
   * write that drops it clears them with it.
   */
  private readonly descendants = new Map<string, Set<string>>();

  /**
   * Writes a value at `path`. Descendants are dropped: whatever was written
   * under this path described the value being replaced, not the new one.
   */
  set(path: string, value: unknown): void {
    const under = this.descendants.get(path);
    if (under) {
      for (const key of under) this.forget(key);
      this.descendants.delete(path);
    }
    if (!this.values.has(path)) this.index(path);
    this.values.set(path, value);
  }

  /** Registers a key under every ancestor prefix, so a write above finds it. */
  private index(key: string): void {
    for (let cut = key.lastIndexOf("."); cut > 0; cut = key.lastIndexOf(".", cut - 1)) {
      const ancestor = key.slice(0, cut);
      let under = this.descendants.get(ancestor);
      if (!under) {
        under = new Set();
        this.descendants.set(ancestor, under);
      }
      under.add(key);
    }
  }

  /** Drops a key and every trace of it in the index. */
  private forget(key: string): void {
    this.values.delete(key);
    this.descendants.delete(key);
    for (let cut = key.lastIndexOf("."); cut > 0; cut = key.lastIndexOf(".", cut - 1)) {
      const ancestor = key.slice(0, cut);
      const under = this.descendants.get(ancestor);
      if (!under) continue;
      under.delete(key);
      if (under.size === 0) this.descendants.delete(ancestor);
    }
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
    this.descendants.clear();
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
