/**
 * Vertex counts, short — shared with the Stats tab rather than written twice: a
 * badge and a tab that round the same number differently read as two numbers.
 *
 * All that remains of the ZAB-78 stats formatting. `formatStats` and `fpsWindow`
 * were ported from the CLI's preview-client and superseded before anything
 * consumed them — the Stats tab (V12) composes its own strings and the fps
 * window lives with the store's frame slice, next to the timestamps it counts.
 */

function compact(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

export { compact };
