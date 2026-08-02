/**
 * @zabloo/react — React bindings for zabloo/ui.
 *
 * JSX drives a custom reconciler (react-three-fiber style: React drives the tree,
 * nothing renders to DOM) that emits the zabloo IR. User-defined React components
 * never reach the IR — they execute at authoring time and emit zabloo primitives.
 *
 * The v1 component set (`Container`, `Text`, `Button`) and the reconciler land with
 * the vertical slice.
 */

export {};
