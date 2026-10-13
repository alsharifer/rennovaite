import { SegmentNotFound } from "@/components/blueprint/shell/SegmentStates";
import { AccountShell } from "@/components/blueprint/shell/ProjectShell";

// K8 #11 (63:1175): inside the shell, one message for "doesn't exist" and "no
// access" — it never confirms that a project exists.
export default function NotFound() {
  return (
    <AccountShell title="Not found">
      <SegmentNotFound />
    </AccountShell>
  );
}
