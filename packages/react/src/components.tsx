import { createElement, type ReactNode } from "react";

export interface ButtonProps {
  id: string;
  variant: string;
  onClick?: string;
  padding: { x: string; y: string };
  background: string;
  radius: string;
  states?: { hover?: { background: string } };
  children?: ReactNode;
}

export interface LabelProps {
  color: string;
  children?: ReactNode;
}

// Button/Label son componentes que renderizan "host components" con tipo string.
// El reconciler los reconoce por ese tipo y construye nodos IR crudos.
export function Button(props: ButtonProps) {
  return createElement("zabloo:button", props, props.children);
}

export function Label(props: LabelProps) {
  return createElement("zabloo:label", props, props.children);
}
