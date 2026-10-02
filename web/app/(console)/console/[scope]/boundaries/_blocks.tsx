import type { ReactNode } from "react";
import { type BoundaryRow, splitByLevel } from "@/lib/views/boundaries";
import { refusalSentence } from "@/lib/views/refusals";
import { BOUNDARIES_TEXT } from "@/content/screens/boundaries";
import { Notice } from "../../../ui/notice";
import { PermissionNotCleared } from "../../../ui/permission-not-cleared";
import { SectionLabel } from "../../../ui/section-label";
import { BoundaryTable } from "./_table";

export interface BoundaryBlocksProps {
  rows: BoundaryRow[];
  /** The node this level writes to; `null` at *me*, where a person sets no
   *  boundary of their own and therefore inherits every one. */
  here: string | null;
  personal: boolean;
  orgLabel: string;
  /** Whether the viewer administers this level: add and remove are theirs. */
  mayAdd: boolean;
  empty: string;
  /** Rendered inside *Set here*, under the table: Commands' starter adds. */
  offer?: ReactNode;
}

/**
 * The two blocks every tab of Boundaries is made of (04 §9, W6-D8).
 *
 * **Inherited** — what reaches this level from above, read-only whoever is
 * looking, each row still naming the level that set it: a boundary is lifted
 * where it was set, and a refusal you cannot look up is indistinguishable from
 * a bug (P17). **Set here** — this level's own rows, with add and remove for
 * an admin of it.
 *
 * One table for both (`_table.tsx`): they are the same rows filtered, not two
 * designs. Pure, so the three tabs share it and a component spec can mount it
 * without a server.
 */
export function BoundaryBlocks({ rows, here, personal, orgLabel, mayAdd, empty, offer }: BoundaryBlocksProps) {
  const split = splitByLevel(rows, here);
  const table = (list: BoundaryRow[], mayRemove: boolean) => (
    <BoundaryTable rows={list} personal={personal} empty={empty} orgLabel={orgLabel} mayRemove={mayRemove} />
  );
  return (
    <>
      <div data-inherited className="grid gap-3">
        <SectionLabel>{BOUNDARIES_TEXT.inherited}</SectionLabel>
        {split.inherited.length === 0 ? (
          <p className="text-base text-muted">{BOUNDARIES_TEXT.inheritedNone}</p>
        ) : (
          <>
            <Notice tone="hold">{BOUNDARIES_TEXT.inheritedReadOnly}</Notice>
            {table(split.inherited, false)}
          </>
        )}
      </div>
      <div data-here className="grid gap-3">
        <SectionLabel>{BOUNDARIES_TEXT.here}</SectionLabel>
        {split.here.length === 0 ? (
          <p className="text-base text-muted">{BOUNDARIES_TEXT.hereNone}</p>
        ) : (
          table(split.here, mayAdd)
        )}
        {offer}
        {!mayAdd && here !== null && <PermissionNotCleared decider={refusalSentence("boundaries.add")} />}
      </div>
    </>
  );
}
