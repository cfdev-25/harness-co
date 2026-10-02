import { Skeleton } from "../../../ui/skeleton";

export default function Loading() {
  return <div className="px-6"><Skeleton rows={6} columns={8} /></div>;
}
