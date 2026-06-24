// Árbol "crudo" que produce el renderer de React: estilos con referencias a tokens (strings).
export interface RawIRButton {
  type: "Button";
  id: string;
  variant: string;
  layout: { paddingX: string; paddingY: string; alignItems: string };
  style: {
    background: string;
    radius: string;
    states?: { hover?: { background: string } };
  };
  actions: { onClick?: string };
  children: RawIRNode[];
}
export interface RawIRLabel {
  type: "Label";
  text: string;
  style: { color: string };
}
export type RawIRNode = RawIRButton | RawIRLabel;

// IR resuelta: tokens bajados a valores concretos (px numéricos, colores hex).
export interface IRButton {
  type: "Button";
  id: string;
  variant: string;
  layout: { paddingX: number; paddingY: number; alignItems: string };
  style: {
    background: string;
    radius: number;
    states?: { hover?: { background: string } };
  };
  actions: { onClick?: string };
  children: IRNode[];
}
export interface IRLabel {
  type: "Label";
  text: string;
  style: { color: string };
}
export type IRNode = IRButton | IRLabel;

export interface IRDocument {
  version: "0.0.1-poc";
  root: IRNode;
}
