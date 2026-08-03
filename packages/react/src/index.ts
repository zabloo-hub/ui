/**
 * @zabloo/react — React bindings for zabloo/ui.
 *
 * JSX drives a custom reconciler (react-three-fiber style: React drives the tree,
 * nothing renders to DOM) that emits the zabloo IR. User-defined React components
 * never reach the IR — they execute at authoring time and emit zabloo primitives.
 */

export {
  Button,
  type ButtonProps,
  Collapse,
  type CollapseProps,
  Column,
  type CommonProps,
  Container,
  type ContainerProps,
  Row,
  Text,
  type TextProps,
} from "./components.js";
export { renderToIR } from "./reconciler.js";
