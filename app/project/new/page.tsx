import { redirect } from "next/navigation";

// The landing CTA points at /project/new; the actual new-project entry
// lives at /project. Redirect so the marketed URL is valid (no 404).
export default function NewProjectRedirect() {
  redirect("/project");
}
