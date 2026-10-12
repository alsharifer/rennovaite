import { SegmentNotFound } from "@/components/blueprint/shell/SegmentStates";

export default function NotFound() {
  return <SegmentNotFound title="We couldn't find that rate book." body="It may have been removed, or it belongs to a firm you are not a member of." href="/firms" action="Your rate books" />;
}
