import { SegmentNotFound } from "@/components/blueprint/shell/SegmentStates";
import { SIGNED_IN_HOME } from "@/lib/auth/link-error";

export default function NotFound() {
  return <SegmentNotFound title="There's nothing here." body="This page isn't available for this project — it may need a feature this deployment has switched off." href={SIGNED_IN_HOME} action="Back to your projects" />;
}
