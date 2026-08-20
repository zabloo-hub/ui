/**
 * Where the chrome's preferences live between reloads — and the one rule that
 * governs every one of them: NOTHING here throws.
 *
 * `localStorage` can be denied outright (a private window, a sandboxed frame),
 * and in a denied context even READING the property throws before any method is
 * called. A preview that failed to boot over a preference would be trading the
 * whole tool for a remembered dropdown, so every access is wrapped and every
 * failure degrades to "no preference". The old page took the same vow in its
 * `remember`/`recall` pair (`preview-client.ts`); this is that contract, typed
 * and injectable — which is also what lets the tests run a store against a
 * storage that throws on purpose.
 */

import type { StateStorage } from "zustand/middleware";

/** The prefix every key of ours carries, shared with the page this replaces. */
export const NAMESPACE = "zabloo.preview";

/** The key `persist` keeps the whole ★ blob under. */
export const STORE_KEY = NAMESPACE;

/**
 * The view you were last looking at, per envelope: a selection is a property of
 * the FILE you are working on, not of the tab, and carrying "hud" over to the
 * next project's envelope would just be wrong. `envelopeId` is the filename (or
 * hash) that `setIdentity` fixes.
 */
export function viewKey(envelopeId: string): string {
  return `${NAMESPACE}.activeView:${envelopeId}`;
}

/** Key-value storage that reports its failures as absence instead of raising. */
export interface PreviewStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

/** `localStorage`, with the vow above wrapped around it. */
export function browserStorage(): PreviewStorage {
  return {
    read(key) {
      // Inside the `try` on purpose: `localStorage` is a getter that throws in a
      // denied context, so the reference itself is the risky part, not `getItem`.
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {}
    },
  };
}

/** A storage that forgets on reload — what the tests run against by default. */
export function memoryStorage(entries: Record<string, string> = {}): PreviewStorage {
  const map = new Map(Object.entries(entries));
  return {
    read: (key) => map.get(key) ?? null,
    write: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

/**
 * The same storage as `persist` wants it. Worth noting what this buys: zustand
 * calls `setItem` inside its own `set`, un-guarded, so a storage that threw on a
 * full quota would make every single action throw. Ours cannot.
 */
export function stateStorage(storage: PreviewStorage): StateStorage {
  return {
    getItem: (name) => storage.read(name),
    setItem: (name, value) => storage.write(name, value),
    removeItem: (name) => storage.remove(name),
  };
}
