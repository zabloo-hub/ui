import { Badge, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { KitCell, KitLabel } from "@/kit/KitCell";

/** The five readouts of the Stats tab, as the artboard fills them in. */
const STATS: readonly { label: string; value: string }[] = [
  { label: "fps", value: "idle" },
  { label: "frame", value: "1.9ms" },
  { label: "draws", value: "42" },
  { label: "verts", value: "18.2k" },
  { label: "atlases", value: "3 · 12MB" },
];

/**
 * The console's tab strip and the content of its Stats tab.
 *
 * The strip is a real `<Tabs>` — the three triggers switch, which is the only
 * way to see that the raised card and the muted rest state are the same pill in
 * two states — but the panel below is NOT its `<TabsContent>`: the artboard
 * shows the strip with Actions selected and the stats at the same time, as two
 * specimens, and wiring them together would hide one of them.
 *
 * `fps: idle` is not a placeholder. The renderer paints on demand, so a preview
 * sitting still has no frame rate to report, and the word is what the statusbar
 * shows in that state.
 */
function ConsoleCell() {
  return (
    <KitCell id="console-tabs" label="Console tabs">
      <Tabs defaultValue="actions">
        <TabsList>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="problems">
            Problems
            <Badge variant="count">1</Badge>
          </TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
        </TabsList>
      </Tabs>

      <KitLabel>Stats tab content</KitLabel>
      <dl className="flex gap-[22px] font-mono text-subtle">
        {STATS.map((stat) => (
          <div key={stat.label} className="flex flex-col gap-[2px]">
            <dt className="text-tag text-muted-foreground">{stat.label}</dt>
            <dd className="text-stat">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </KitCell>
  );
}

export { ConsoleCell };
