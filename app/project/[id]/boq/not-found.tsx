import { SegmentNotFound } from "@/components/blueprint/shell/SegmentStates";

export default function NotFound() {
  return <SegmentNotFound title="There's nothing here." body="This page isn't available for this project — it may need a feature this deployment has switched off." href="/dashboard" action="Back to your projects" />;
}
