import { Skeleton } from "../../ui/skeleton";

export default function Loading() {
  return <div className="px-6"><Skeleton rows={12} columns={2} /></div>;
}
