/**
 * Which data paths an envelope binds, and what kind of value each one holds.
 *
 * The walk is `collectBindPaths` from `packages/cli/src/preview-client.ts`
 * (ZAB-57), unchanged. What is new is the TYPE: the envelope declares none, but
 * the binding SITE does — a path bound into `visible` is a boolean — which is
 * what lets the panel offer a checkbox instead of a box you type `true` into.
 */

type BindingType = "boolean" | "number" | "string" | "array" | "object";

interface Binding {
  path: string;
  type: BindingType;
}

/** Sites whose type depends on the node: a Slider's `value` is not a TextInput's. */
const BY_NODE: Record<string, Record<string, BindingType>> = {
  Slider: { value: "number" },
  ProgressBar: { value: "number" },
  TextInput: { value: "string" },
  Container: { value: "string" },
};

/** Sites that mean the same thing wherever they appear. */
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
 * the format is forward-tolerant, so a prop from a later version has to degrade
 * into the editor that can express anything, not into a guess.
 */
function typeAt(nodeType: string, prop: string): BindingType {
  return BY_NODE[nodeType]?.[prop] ?? BY_PROP[prop] ?? "string";
}

/** How much a type commits to — only `string` is a fallback, so it loses a conflict. */
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
 * Sorted by path, so a save does not reshuffle the panel under the cursor.
 */
function collectBindings(node: unknown): Binding[] {
  const found = new Map<string, BindingType>();
  walk(node, ROOT, found);
  return [...found]
    .map(([path, type]): Binding => ({ path, type }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function walk(value: unknown, site: Site, found: Map<string, BindingType>): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, site, found);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.bind === "string") add(found, record.bind, typeAt(site.nodeType, site.prop));
  // A `style` or `states` block declares no `type`: the node stays the one above,
  // while the prop moves to the one being read right here.
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
 * The same path read two ways. The panel offers ONE editor for it, so the site
 * that committed to something wins over the `string` fallback — and which one it
 * picked is said out loud, because that is the difference between a bug and a
 * decision. Two committed sites are a tie: the first walked keeps it.
 */
function add(found: Map<string, BindingType>, path: string, type: BindingType): void {
  const seen = found.get(path);
  if (seen === undefined) {
    found.set(path, type);
    return;
  }
  if (seen === type) return;
  const winner = RANK[type] > RANK[seen] ? type : seen;
  console.warn(
    `zabloo preview: "${path}" is bound as ${seen} and as ${type} — editing it as ${winner}`,
  );
  found.set(path, winner);
}

export type { Binding, BindingType };
export { collectBindings };
