import { ChevronDown } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuDot,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui";
import { useViews } from "@/store/hooks";

/**
 * Which of the envelope's views is on screen (artboards 1a, 1b, kit 1e).
 *
 * It paints the `views` slice and nothing else. The hard part — keeping your
 * place across a hot-update that rewrites the list, and remembering the choice
 * per envelope — is the slice's, so a view added while the preview is open
 * shows up here the moment `setViews` lands, with no remount and no rebuilt
 * `<option>` list like the `syncViewOptions` this replaces (ZAB-72).
 *
 * The order is the envelope's, never alphabetical: it is the order the author
 * wrote the views in, and sorting them here would hide that.
 *
 * A `<DropdownMenu>` uncontrolled, unlike the viewport picker beside it: every
 * row selects, so Radix's own close-on-select is enough, and the keyboard
 * (arrows, Enter, Esc, typeahead) comes for free.
 */
function ViewSelector() {
  const { views, activeView, fatalViews, selectView } = useViews();
  const empty = views.length === 0;
  const activeIsFatal = activeView !== null && fatalViews.has(activeView);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Labelled, because the caption and the name are two spans with a gap
            and no whitespace between them: read as content the name would come
            out "Viewcontrols". Same fix, same reason as the viewport picker's,
            and the same place the dot has to say itself. */}
        <Button
          variant="outline"
          size="sm"
          aria-label={activeIsFatal ? "View (has errors)" : "View"}
          disabled={empty}
          className="gap-[7px]"
        >
          <span className="text-caption font-normal text-muted-foreground">View</span>
          {/* An em dash rather than an empty trigger: the control keeps its
              shape until the first envelope arrives. */}
          <span>{activeView ?? "—"}</span>
          {/* No `ml-auto` here: in the trigger the dot sits between the name and
              the chevron, not pinned to a right edge. */}
          {activeIsFatal && <DropdownMenuDot aria-hidden="true" className="ml-0" />}
          <ChevronDown className="size-[10px] text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[200px]">
        {views.map((id) => (
          <DropdownMenuItem
            key={id}
            size="lg"
            // Colour alone says "the validator refused this one" to nobody, so
            // the dot is decorative and the row says it in its name — a label
            // and not a hidden span beside the dot, because a name is built by
            // concatenating each piece of text TRIMMED, and the row would come
            // out called "overlayshas errors". Radix's typeahead reads the
            // content, so jumping to a view by typing is unaffected.
            aria-label={fatalViews.has(id) ? `${id} (has errors)` : undefined}
            data-active={id === activeView || undefined}
            onSelect={() => selectView(id)}
          >
            {id}
            {fatalViews.has(id) && <DropdownMenuDot aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { ViewSelector };
