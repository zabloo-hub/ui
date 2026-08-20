/**
 * Every primitive the chrome is built from, in one import.
 *
 * The exit criterion of ZAB-84 is that V7–V17 import from `@/components/ui` and
 * never from a file inside it — so that swapping a primitive for another, or
 * splitting one in two, is a change in this folder and nowhere else. The files
 * keep shadcn's kebab-case names on purpose: they are vendored, and a future
 * `shadcn add` has to land on top of them for its diff to be readable.
 */
export { Badge, BadgeDot, badgeVariants } from "@/components/ui/badge";
export { Button, buttonVariants } from "@/components/ui/button";
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cardVariants,
} from "@/components/ui/card";
export {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuDot,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuValue,
  dropdownMenuItemVariants,
  menuSurface,
} from "@/components/ui/dropdown-menu";
export { Input, InputFrame, inputVariants } from "@/components/ui/input";
export { NumberInput, type NumberInputProps } from "@/components/ui/number-input";
export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
export { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
export { Separator, separatorVariants } from "@/components/ui/separator";
export { Switch } from "@/components/ui/switch";
export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants } from "@/components/ui/tabs";
export { Toggle, toggleVariants } from "@/components/ui/toggle";
export {
  ToggleGroup,
  ToggleGroupItem,
  toggleGroupItemVariants,
  toggleGroupVariants,
} from "@/components/ui/toggle-group";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
