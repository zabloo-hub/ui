/**
 * The data the preview is holding on the game's behalf, path by path.
 *
 * The preview plays the GAME's role (ZAB-57): the envelope declares the paths it
 * binds, the panel offers a field per path, and whatever is typed is pushed
 * through `setData` — while controls write their own values BACK through the same
 * channel, which is the whole point of a two-way binding.
 *
 * Two contracts are carried over from the old `dataValues` map, and both are why
 * `byPath` is never pruned:
 *
 * - Values SURVIVE a reload and are re-pushed after every mount. The dev loop
 *   reloads on every save, and a store that forgot `player.gold = 1250` each time
 *   would make testing anything with data a chore.
 * - A control inside a `Repeat` writes an ITEM path (`shop.items.3.fav`) that the
 *   envelope never declared — those addresses are relative to the item, so
 *   `collectBindPaths` skips them by design. They are values like any other and
 *   have to be kept and replayed, so `setFromUI` accepts a path nobody declared.
 *
 * `order` is therefore not "everything we know" but "what the envelope declares
 * right now, alphabetically" — the panel's list. A path that disappears from an
 * envelope leaves the panel and keeps its value; if a later save brings it back,
 * the value is still there.
 */

import type { Getter, Setter } from "./state";

export type BindingType = "boolean" | "number" | "string" | "array" | "object";

/** Who wrote last — `'ui'` is what raises the `← UI` chip in the panel (V15). */
export type WriteSource = "editor" | "ui";

export interface Binding {
  path: string;
  type: BindingType;
  value: unknown;
  lastWriteFrom: WriteSource | null;
  /** When the UI wrote, so the chip can fade on its own. */
  writtenAt: number | null;
}

/** What the envelope declares: a path and the type its binding site implies. */
export interface Declaration {
  path: string;
  type: BindingType;
}

export interface BindingsSlice {
  bindings: {
    byPath: Record<string, Binding>;
    order: string[];
  };
  declare(declarations: Declaration[]): void;
  setFromEditor(path: string, value: unknown): void;
  setFromUI(path: string, value: unknown): void;
  clearUIMark(path: string): void;
}

export function createBindingsSlice(set: Setter, get: Getter): BindingsSlice {
  function write(path: string, value: unknown, from: WriteSource): void {
    const { byPath, order } = get().bindings;
    const held = byPath[path];
    const next: Binding = {
      path,
      type: held?.type ?? inferType(value),
      value,
      lastWriteFrom: from,
      // The chip is a `'ui'` affair; an edit of your own is not news.
      writtenAt: from === "ui" ? Date.now() : null,
    };
    set({ bindings: { byPath: { ...byPath, [path]: next }, order } });
  }

  return {
    bindings: { byPath: {}, order: [] },

    declare: (declarations) => {
      const { byPath } = get().bindings;
      const merged: Record<string, Binding> = { ...byPath };
      for (const { path, type } of declarations) {
        const held = merged[path];
        // The envelope is the authority on the TYPE; everything else the path
        // already carried is its own.
        merged[path] = held
          ? { ...held, type }
          : { path, type, value: undefined, lastWriteFrom: null, writtenAt: null };
      }
      set({
        bindings: {
          byPath: merged,
          order: declarations.map((declaration) => declaration.path).sort(),
        },
      });
    },

    setFromEditor: (path, value) => write(path, value, "editor"),
    setFromUI: (path, value) => write(path, value, "ui"),

    clearUIMark: (path) => {
      const { byPath, order } = get().bindings;
      const held = byPath[path];
      if (held === undefined || held.lastWriteFrom !== "ui") return;
      set({
        bindings: {
          byPath: { ...byPath, [path]: { ...held, lastWriteFrom: null, writtenAt: null } },
          order,
        },
      });
    },
  };
}

/**
 * The type of a path nobody declared, read off the value itself. Only ever used
 * for the item paths above — a declared path takes the type of its binding SITE
 * (`checked` is a boolean even when the game has not pushed one yet), which the
 * bridge decides and this slice is told.
 */
export function inferType(value: unknown): BindingType {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "array";
  if (value !== null && typeof value === "object") return "object";
  return "string";
}
