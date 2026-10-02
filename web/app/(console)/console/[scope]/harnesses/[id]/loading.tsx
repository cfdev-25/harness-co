import { Skeleton } from "../../../../ui/skeleton";

/** 04 §5: header skeleton plus eight row skeletons, content region only. */
export default function Loading() {
  return (
    <div className="grid gap-6 px-6 py-6">
      <Skeleton rows={2} columns={3} />
      <Skeleton rows={8} columns={6} />
    </div>
  );
}
