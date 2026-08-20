/**
 * Which data paths an envelope BINDS, and what kind of value each one holds.
 *
 * Ported from `collectBindPaths` in `packages/cli/src/preview-client.ts` (ZAB-57),
 * which the CLI's preview page still runs until V18 retires it. The walk is the
 * same one, with its `Repeat` rule intact — that part is the memory of the dev
 * loop and is not up for reinterpretation. What is new here is the TYPE.
 *
 * The envelope declares no types for data: `{ bind: "shop.open" }` says where a
 * value goes, never what it is. But the design already teaches it — a path bound
 * into `visible` is a boolean, one bound into a `Repeat`'s `items` is an array —
 * so the binding SITE is the type, and reading it is what lets the panel offer a
 * checkbox instead of a text box you have to type `true` into.
 */

/** What kind of value a bound path holds, as far as the binding site says. */
export type BindingType = "boolean" | "number" | "string" | "array" | "object";

/** One data path the game is expected to push, and what it should push into it. */
export interface Binding {
  path: string;
  type: BindingType;
}

/**
 * Sites whose type depends on the NODE, not just on the prop name. `value` is the
 * ambiguous one: a Slider's is a number, a TextInput's is the text being edited,
 * and a radio group's is whichever option is selected — the same word for three
 * different values, which is why the table is keyed by the node first.
 */
const BY_NODE: Record<string, Record<string, BindingType>> = {
  Slider: { value: "number" },
  ProgressBar: { value: "number" },
  TextInput: { value: "string" },
  Container: { value: "string" },
};

/** Sites that mean the same thing on every node that has them. */
const BY_PROP: Record<string, BindingType> = {
  checked: "boolean",
  visible: "boolean",
  disabled: "boolean",
  open: "boolean",
  items: "array",
  text: "string",
  src: "string",
  placeholder: "string",
};

/**
 * The type a binding at this site holds. An unknown prop falls back to `string`:
 * the format is forward-tolerant (SDKs ignore props they do not know), so a prop
 * from a later version has to degrade into the editor that can express anything,
 * not into a guess.
 */
function typeAt(nodeType: string, prop: string): BindingType {
  return BY_NODE[nodeType]?.[prop] ?? BY_PROP[prop] ?? "string";
}

/**
 * How much a type commits to. Only `string` is a fallback — everything else was
 * read off a site the design actually names, so it wins a conflict.
 */
const RANK: Record<BindingType, number> = {
  string: 0,
  object: 1,
  array: 1,
  number: 1,
  boolean: 1,
};

/** Where a binding was found: the nearest enclosing node, and the prop it hangs from. */
interface Site {
  nodeType: string;
  prop: string;
}

const ROOT: Site = { nodeType: "", prop: "" };

/**
 * Every data path the envelope BINDS — the ones the game is expected to push.
 *
 * Inside a `Repeat` template the paths are RELATIVE to the item (`"item.name"`):
 * they are addresses into the array, not values anyone pushes, so the template
 * child is skipped. Everything else about the Repeat is walked — its bound
 * array, its own `visible`, and the empty state, all of which the game does feed.
 *
 * The result is sorted by path so the panel does not reshuffle itself on a save.
 */
export function collectBindings(node: unknown): Binding[] {
  const found = new Map<string, BindingType>();
  walk(node, ROOT, found);
  return [...found]
    .map(([path, type]): Binding => ({ path, type }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function walk(value: unknown, site: Site, found: Map<string, BindingType>): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    // An array is not a site of its own — its items keep the prop they hang from,
    // and each one that declares a `type` becomes the node for what is inside it.
    for (const item of value) walk(item, site, found);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.bind === "string") add(found, record.bind, typeAt(site.nodeType, site.prop));
  // A `style` or a `states` block declares no `type`: the nearest node above is
  // still the node, while the prop moves to the one being read right here.
  const nodeType = typeof record.type === "string" ? record.type : site.nodeType;
  if (record.type === "Repeat") {
    const { children, ...rest } = record;
    for (const [prop, nested] of Object.entries(rest)) walk(nested, { nodeType, prop }, found);
    const empty = Array.isArray(children) ? children.slice(1) : [];
    for (const child of empty) walk(child, { nodeType, prop: "children" }, found);
    return;
  }
  for (const [prop, nested] of Object.entries(record)) walk(nested, { nodeType, prop }, found);
}

/**
 * The same path bound in two places with two readings of it. The design is what
 * it is — a path fed into both a `visible` and a `text` exists — so this picks
 * the site that committed to something and says so once, out loud: the panel is
 * about to offer ONE editor for a path the envelope reads two ways, and knowing
 * which one it picked is the difference between a bug and a decision.
 */
function add(found: Map<string, BindingType>, path: string, type: BindingType): void {
  const seen = found.get(path);
  if (seen === undefined) {
    found.set(path, type);
    return;
  }
  if (seen === type) return;
  // Two sites that both committed (a boolean and a number) are a tie: the first
  // one walked keeps it, so the panel is at least stable across saves.
  const winner = RANK[type] > RANK[seen] ? type : seen;
  console.warn(
    `zabloo preview: "${path}" is bound as ${seen} and as ${type} — editing it as ${winner}`,
  );
  found.set(path, winner);
}
