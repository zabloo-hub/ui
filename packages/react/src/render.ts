import Reconciler from "react-reconciler";
import type { ReactElement } from "react";
import type { RawIRNode } from "@zabloo/core";
import { hostConfig, type Container, type HostNode } from "./host-config.js";
import { serialize } from "./serialize.js";

const reconciler = Reconciler(hostConfig as any);

export function renderToIR(element: ReactElement): RawIRNode {
  const container: Container = { children: [] };
  // tag 0 = LegacyRoot → el mount inicial es síncrono.
  const root = reconciler.createContainer(
    container, 0, null, false, null, "", (e: unknown) => { throw e; }, null,
  );
  reconciler.updateContainer(element, root, null, null);
  if (container.children.length !== 1) {
    throw new Error(`renderToIR espera exactamente 1 nodo raíz, recibió ${container.children.length}`);
  }
  return serialize(container.children[0] as HostNode);
}
