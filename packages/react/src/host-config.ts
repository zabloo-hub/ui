import { DefaultEventPriority } from "react-reconciler/constants.js";

// Nodo host crudo que produce el reconciler.
export interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children: Array<HostNode | TextNode>;
}
export interface TextNode { text: string }
export interface Container { children: Array<HostNode | TextNode> }

const noop = () => {};

export const hostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  isPrimaryRenderer: true,
  noTimeout: -1,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  supportsMicrotasks: true,
  scheduleMicrotask: queueMicrotask,

  getRootHostContext: () => null,
  getChildHostContext: (parent: unknown) => parent,
  getPublicInstance: (i: unknown) => i,
  prepareForCommit: () => null,
  resetAfterCommit: noop,
  preparePortalMount: noop,
  shouldSetTextContent: () => false,
  getCurrentEventPriority: () => DefaultEventPriority,
  clearContainer: (c: Container) => { c.children = []; },
  detachDeletedInstance: noop,

  createInstance: (type: string, props: Record<string, unknown>): HostNode => ({
    type, props, children: [],
  }),
  createTextInstance: (text: string): TextNode => ({ text }),
  appendInitialChild: (parent: HostNode, child: HostNode | TextNode) => { parent.children.push(child); },
  appendChild: (parent: HostNode, child: HostNode | TextNode) => { parent.children.push(child); },
  appendChildToContainer: (container: Container, child: HostNode | TextNode) => { container.children.push(child); },
  finalizeInitialChildren: () => false,
  prepareUpdate: () => null,

  // No-ops: render one-shot, sin updates ni eventos.
  commitUpdate: noop,
  commitTextUpdate: noop,
  removeChild: noop,
  removeChildFromContainer: noop,
  insertBefore: noop,
  commitMount: noop,
  hideInstance: noop,
  unhideInstance: noop,
  hideTextInstance: noop,
  unhideTextInstance: noop,
};
