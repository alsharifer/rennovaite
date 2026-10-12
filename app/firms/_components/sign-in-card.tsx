import { Button } from "@/components/blueprint/Button";
import { StateBlock } from "@/components/blueprint/StateBlock";

/**
 * What a signed-out visitor would see on a members-only page (U2). Since H1
 * the proxy sends a signed-out visit to /auth first, so this is the backstop;
 * K8: a Blueprint gate block, like every other refusal.
 */
export function SignInCard({ what }: { what: string }) {
  return (
    <StateBlock
      kind="gate"
      title={`Sign in to see ${what}`}
      actions={
        <Button kind="primary" tone="inverse" href="/auth">
          Sign in
        </Button>
      }
    >
      Rate books belong to firms, and a firm belongs to the accounts that are its members. Sign in with the email that was added to the firm.
    </StateBlock>
  );
}
