import { Skeleton } from "../../../../ui/skeleton";

/** 02 rule 8: the chrome is already there, so only the rows are grey. */
export default function Loading() {
  return <div className="px-6"><Skeleton rows={8} columns={7} /></div>;
}
