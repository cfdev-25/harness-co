import type { ReactNode } from "react";
import type { Fact } from "@/lib/views/types";
import { Dot } from "./dot";

export interface FactCellProps {
  fact: Fact<ReactNode>;
}

/** Where a value came from, said in the cell (K3, P2). */
export function FactCell({ fact }: FactCellProps) {
  if (fact.provenance === "observed") {
    return (
      <span className="inline-flex items-center gap-2" title={`Checked just now · ${fact.at ?? ""}`}>
        {fact.value}
        <Dot tone="accent" />
      </span>
    );
  }
  if (fact.provenance === "derived") {
    return (
      <span title="Derived" className="underline decoration-dotted underline-offset-4">
        {fact.value}
      </span>
    );
  }
  return <>{fact.value}</>;
}
