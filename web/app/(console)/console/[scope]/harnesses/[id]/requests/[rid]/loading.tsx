import { Skeleton } from "../../../../../../ui/skeleton";

/** 04 §7: the two-column skeleton, in the content region only. */
export default function Loading() {
  return (
    <div className="grid gap-6 px-6 py-6">
      <Skeleton rows={1} columns={2} />
      <Skeleton rows={6} columns={1} />
    </div>
  );
}
