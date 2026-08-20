/**
 * The custom reconciler (react-three-fiber style): React drives the tree, nothing
 * renders to DOM. Host components are the zabloo primitives; mounting produces
 * `HostInstance` objects that `toIR` serializes into `@zabloo/format` nodes.
 *
 * v1 is one-shot (`renderToIR` for `zabloo export`), but the config implements the
 * full mutation mode so the same reconciler can drive the future dev loop
 * (watch → re-render → push IR over WebSocket) without a rewrite.
 */

import type { ZNode } from "@zabloo/format";
import { createContext, type ReactNode } from "react";
import Reconciler from "react-reconciler";
// Extension included on purpose: `react-reconciler` ships no `exports` map, so
// Node's ESM resolver needs the real filename. Without it the published bundle
// is unimportable from Node (`ERR_MODULE_NOT_FOUND`) even though Vitest's
// bundler-style resolver — and our `moduleResolution: "Bundler"` — accept it.
import { DefaultEventPriority, LegacyRoot } from "react-reconciler/constants.js";
import {
  createHostInstance,
  type HostContainer,
  type HostInstance,
  type HostNode,
  type HostTextInstance,
  toIR,
} from "./host.js";

type Props = HostInstance["props"] & { children?: ReactNode };

/** Sentinel host context — we track nothing, but React requires a non-null one. */
const HOST_CONTEXT = {};
type HostContext = typeof HOST_CONTEXT;

/**
 * React's event-priority protocol is a getter/setter pair over one mutable slot,
 * so the slot is a field of a `const` holder rather than a module-level `let`.
 */
const updatePriority = { current: DefaultEventPriority as number };

const reconciler = Reconciler<
  string, // Type
  Props, // Props
  HostContainer, // Container
  HostInstance, // Instance
  HostTextInstance, // TextInstance
  never, // SuspenseInstance
  never, // HydratableInstance
  never, // FormInstance
  HostInstance, // PublicInstance
  HostContext, // HostContext
  never, // ChildSet
  ReturnType<typeof setTimeout>, // TimeoutHandle
  -1, // NoTimeout
  null // TransitionStatus
>({
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,

  // --- creation ---
  createInstance(type, props) {
    // Strip children: they arrive as child instances, never as data.
    const { children: _children, ...rest } = props;
    return createHostInstance(type, rest);
  },
  createTextInstance(text): HostTextInstance {
    return { kind: "text", text };
  },
  appendInitialChild(parent, child) {
    parent.children.push(child);
  },
  finalizeInitialChildren() {
    return false;
  },
  shouldSetTextContent() {
    return false;
  },

  // --- host context ---
  getRootHostContext() {
    return HOST_CONTEXT;
  },
  getChildHostContext(parentHostContext) {
    return parentHostContext;
  },
  getPublicInstance(instance) {
    return instance as HostInstance;
  },

  // --- commit hooks ---
  prepareForCommit() {
    return null;
  },
  resetAfterCommit() {},
  preparePortalMount() {},
  clearContainer(container) {
    container.children.length = 0;
  },

  // --- mutation ---
  appendChild(parent, child) {
    parent.children.push(child);
  },
  appendChildToContainer(container, child) {
    container.children.push(child);
  },
  insertBefore(parent, child, beforeChild) {
    insertBefore(parent.children, child, beforeChild);
  },
  insertInContainerBefore(container, child, beforeChild) {
    insertBefore(container.children, child, beforeChild);
  },
  removeChild(parent, child) {
    remove(parent.children, child as HostNode);
  },
  removeChildFromContainer(container, child) {
    remove(container.children, child as HostNode);
  },
  commitTextUpdate(textInstance, _oldText, newText) {
    textInstance.text = newText;
  },
  commitUpdate(instance, _type, _prevProps, nextProps) {
    const { children: _children, ...rest } = nextProps;
    instance.props = rest;
  },
  resetTextContent() {},
  hideInstance() {},
  unhideInstance() {},
  hideTextInstance() {},
  unhideTextInstance() {},
  detachDeletedInstance() {},

  // --- scheduling ---
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  supportsMicrotasks: true,
  scheduleMicrotask: queueMicrotask,
  shouldAttemptEagerTransition() {
    return false;
  },
  requestPostPaintCallback() {},
  trackSchedulerEvent() {},
  resolveEventType() {
    return null;
  },
  resolveEventTimeStamp() {
    return -1;
  },

  // --- update priority (React 19 event-priority protocol) ---
  setCurrentUpdatePriority(newPriority) {
    updatePriority.current = newPriority;
  },
  getCurrentUpdatePriority() {
    return updatePriority.current;
  },
  resolveUpdatePriority() {
    return updatePriority.current || DefaultEventPriority;
  },

  // --- transitions / forms (unused) ---
  NotPendingTransition: null,
  // React's internal context shape — the public Context type lacks the internal
  // fields the reconciler types expect, hence the cast.
  HostTransitionContext: createContext<null>(null) as unknown as Reconciler.ReactContext<null>,
  resetFormInstance() {},

  // --- suspense-y commit (unused) ---
  maySuspendCommit() {
    return false;
  },
  preloadInstance() {
    return true;
  },
  startSuspendingCommit() {},
  suspendInstance() {},
  waitForCommitToBeReady() {
    return null;
  },

  // --- misc internals ---
  getInstanceFromNode() {
    return null;
  },
  getInstanceFromScope() {
    return null;
  },
  prepareScopeUpdate() {},
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
});

function insertBefore(list: HostNode[], child: HostNode, beforeChild: HostNode): void {
  remove(list, child);
  const index = list.indexOf(beforeChild);
  list.splice(index === -1 ? list.length : index, 0, child);
}

function remove(list: HostNode[], child: HostNode): void {
  const index = list.indexOf(child);
  if (index !== -1) list.splice(index, 1);
}

/**
 * Mounts a React element with the zabloo reconciler and returns the IR node tree
 * it emits. One-shot: mounts synchronously, serializes, unmounts.
 *
 * The element must resolve to exactly one root primitive (a single `ZNode` per
 * view — wrap multiple roots in a `Container`).
 */
export function renderToIR(element: ReactNode): ZNode {
  const container: HostContainer = { children: [] };
  // React reports render errors via callbacks (possibly outside the sync stack);
  // collect them and fail the export loudly after the flush.
  const errors: unknown[] = [];
  const collect = (error: unknown) => {
    errors.push(error);
  };
  const root = reconciler.createContainer(
    container,
    LegacyRoot,
    null,
    false,
    null,
    "zabloo",
    collect, // onUncaughtError
    collect, // onCaughtError
    collect, // onRecoverableError
    () => {},
  );

  reconciler.updateContainerSync(element, root, null, null);
  reconciler.flushSyncWork();

  try {
    if (errors.length > 0) {
      throw errors[0] instanceof Error ? errors[0] : new Error(String(errors[0]));
    }
    if (container.children.length !== 1) {
      throw new Error(
        `A view must emit exactly one root primitive, got ${container.children.length}. ` +
          `Wrap siblings in a <Container>.`,
      );
    }
    const rootNode = container.children[0];
    if (rootNode.kind === "text") {
      throw new Error("A view's root must be a primitive, not raw text — wrap it in <Text>.");
    }
    return toIR(rootNode);
  } finally {
    reconciler.updateContainerSync(null, root, null, null);
    reconciler.flushSyncWork();
  }
}
