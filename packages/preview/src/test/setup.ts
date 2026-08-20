import "@testing-library/jest-dom/vitest";

/**
 * jsdom has no layout, and therefore no `ResizeObserver`. Radix uses one to
 * decide whether a scroll area overflows, so `<ScrollArea>` throws on mount
 * without this — and so will anything else measuring itself (V10's stage
 * scaling, V14's drag bounds).
 *
 * A stub that never fires, not a polyfill: nothing in jsdom would ever resize,
 * so an observer that reports no entries is the honest answer rather than a
 * pretend one.
 */
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
