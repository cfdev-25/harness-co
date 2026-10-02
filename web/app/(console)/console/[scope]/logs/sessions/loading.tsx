import { Skeleton } from "../../../../ui/skeleton";

/** 04 §13: one skeleton per card, content region only. */
export default function Loading() {
  return (
    <div className="grid gap-6 px-6 py-6">
      <Skeleton rows={8} columns={8} />
    </div>
  );
}
