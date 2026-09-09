import { TableSkeleton } from "@/components/app/boundaries";

export default function Loading() {
  return (
    <div className="p-12">
      <TableSkeleton rows={7} />
    </div>
  );
}
