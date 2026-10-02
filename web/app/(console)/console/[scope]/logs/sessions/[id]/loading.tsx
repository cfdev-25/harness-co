import { Skeleton } from "../../../../../ui/skeleton";

/** 04 §13: one skeleton per card (02 rule 8). */
export default function Loading() {
  return (
    <div className="grid gap-6 px-6 py-6">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="rounded-lg border border-line bg-surface p-4">
          <Skeleton rows={3} columns={4} />
        </div>
      ))}
    </div>
  );
}
