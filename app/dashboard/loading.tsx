import { PageSkeleton } from "@/components/app/boundaries";

export default function Loading() {
  return (
    <div className="p-12">
      <PageSkeleton rows={4} />
    </div>
  );
}
