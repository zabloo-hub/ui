import type { IRNode, IRDocument } from "./types.js";

export function buildDocument(root: IRNode): IRDocument {
  return { version: "0.0.1-poc", root };
}
