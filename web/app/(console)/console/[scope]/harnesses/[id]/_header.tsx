import type { HarnessView } from "@/lib/views/harness";
import { headerFacts } from "@/lib/views/harness";
import type { Scope, Viewer } from "@/lib/views/types";
import { HARNESS_WORDS as WORDS } from "@/content/screens/harness";
import { HARNESSES } from "@/content/screens/harnesses";
import { scopeHref } from "@/lib/scope";
import { EntityHeader } from "../../../../ui/entity-header";
import { FactCell } from "../../../../ui/fact-cell";
import { PixelArt } from "../../../../ui/pixel-art";
import { ScaleTag } from "../../../../ui/scale-tag";

/**
 * The harness, as the first block of content (01 §7.5, D99): its drawing,
 * its name and 04 §5's two-by-three grid. It is content and not a header —
 * the page's name is *Harnesses* in the top bar, and the screen's one strip
 * is the bar above this — so the six facts scroll away once read.
 */
export function HarnessHeader({
  view,
  viewer,
  scope,
}: {
  view: HarnessView;
  viewer: Viewer;
  scope: Scope;
}) {
  return (
    <EntityHeader
      name={view.def.name}
      trail={[{ label: HARNESSES.title, href: scopeHref(scope, "/harnesses") }]}
      mark={<PixelArt icon={view.def.icon} size={56} alt={view.def.name} />}
      facts={headerGrid(view, viewer)}
    />
  );
}

/**
 * Six cells at `enterprise`, four at `personal` (07 §3) — which cells, and
 * their labels, are `lib/views/harness.ts`'s decision; this file only draws
 * them. Preflight is the one `derived` cell, so it is the one that reads as
 * derived (K3).
 */
function headerGrid(view: HarnessView, viewer: Viewer) {
  return headerFacts(view, viewer, WORDS.header).map((cell) => ({
    label: cell.label,
    value: (
      <FactCell
        fact={{
          ...cell.fact,
          value: cell.scale ? (
            <ScaleTag scale={cell.scale} value={String(cell.fact.value)} size="sm" />
          ) : Array.isArray(cell.fact.value) ? (
            cell.fact.value.join(", ") || "—"
          ) : (
            (cell.fact.value ?? "—")
          ),
        }}
      />
    ),
  }));
}
