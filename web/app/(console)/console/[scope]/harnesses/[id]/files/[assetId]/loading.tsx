import { Skeleton } from "../../../../../../ui/skeleton";

/** 04 §6: sub-header and content skeleton, in the content region only. */
export default function Loading() {
  return (
    <div className="grid gap-6 px-6 py-6">
      <Skeleton rows={1} columns={2} />
      <Skeleton rows={10} columns={1} />
    </div>
  );
}
