import { PageSkeleton } from "@/components/app/boundaries";

export default function Loading() {
  return (
    <div className="p-12">
      <PageSkeleton rows={3} />
    </div>
  );
}
