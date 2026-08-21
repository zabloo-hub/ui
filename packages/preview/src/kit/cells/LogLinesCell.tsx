import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { KitCell, KitLabel } from "@/kit/KitCell";

/**
 * The three kinds of line the action log writes, and the two severities the
 * problems list marks a diagnostic with.
 *
 * The keyword carries the colour and the rest of the line does not: `action` is
 * indigo, `write` is the log's green — its own token, a shade darker than `--ok`
 * so it holds up at 11.5px — and `view` is muted, because a view loading is the
 * one of the three that is not something the developer's UI did.
 */
const LINES: readonly { time: string; kind: string; tone: string; rest: ReactNode }[] = [
  {
    time: "12:04:31",
    kind: "action",
    tone: "text-log-action",
    rest: (
      <>
        buy → shop.items.3 <span className="text-muted-foreground">(#3)</span>
      </>
    ),
  },
  { time: "12:04:31", kind: "write", tone: "text-log-write", rest: "settings.sfx = true" },
  { time: "12:04:27", kind: "view", tone: "text-muted-foreground", rest: "loaded → controls" },
];

function LogLinesCell() {
  return (
    <KitCell id="log-lines" label="Log line types">
      <div className="font-mono text-log text-subtle">
        {LINES.map((line) => (
          <div key={`${line.time}-${line.kind}`}>
            <span className="text-faint">{line.time}</span>{" "}
            <span className={line.tone}>{line.kind}</span> {line.rest}
          </div>
        ))}
      </div>

      <KitLabel>Diagnostic severities</KitLabel>
      <div className="flex gap-2">
        <Badge variant="severity-fatal">FATAL</Badge>
        <Badge variant="severity-warn">WARN</Badge>
      </div>
    </KitCell>
  );
}

export { LogLinesCell };
