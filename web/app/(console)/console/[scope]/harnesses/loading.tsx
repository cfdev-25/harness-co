import { Skeleton } from "../../../ui/skeleton";

/** 04 §4: six card skeletons, in the content region only (02 rule 8). */
export default function Loading() {
  return (
    <div className="grid gap-4 px-6 py-6 [grid-template-columns:repeat(auto-fill,minmax(19rem,1fr))]">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="rounded-lg border border-line bg-surface p-4">
          <Skeleton rows={3} columns={2} />
        </div>
      ))}
    </div>
  );
}
