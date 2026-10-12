import { redirect } from "next/navigation";

// K2 (spec §3.10): support is a help drawer on every page now. The old route
// opens it on Settings, so a bookmark still lands somewhere useful.
export default function SupportPage() {
  redirect("/settings?help=1");
}
