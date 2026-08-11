/**
 * @zabloo/react — React bindings for zabloo/ui.
 *
 * JSX drives a custom reconciler (react-three-fiber style: React drives the tree,
 * nothing renders to DOM) that emits the zabloo IR. User-defined React components
 * never reach the IR — they execute at authoring time and emit zabloo primitives.
 */

export {
  Accordion,
  Badge,
  type BadgeProps,
  Button,
  type ButtonProps,
  Checkbox,
  type CheckboxProps,
  Collapse,
  type CollapseProps,
  Column,
  type CommonProps,
  Container,
  type ContainerProps,
  Image,
  type ImageProps,
  ProgressBar,
  type ProgressBarProps,
  Radio,
  RadioGroup,
  type RadioGroupProps,
  type RadioProps,
  Row,
  ScrollView,
  type ScrollViewProps,
  Slider,
  type SliderProps,
  Spinner,
  type SpinnerProps,
  Switch,
  type SwitchProps,
  Tab,
  type TabProps,
  Tabs,
  type TabsProps,
  Text,
  type TextProps,
  type ToggleControlProps,
} from "./components.js";
export { renderToIR } from "./reconciler.js";
export { ThemeProvider, type ThemeVariants, type VariantDef, type ZablooTheme } from "./theme.js";
