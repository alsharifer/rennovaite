import { redirect } from "next/navigation";

// The canonical project-intake screen is the Atelier-rebuilt /project/new.
// /project (and the sidebar "AI Designer" link) forwards there so there's a
// single, on-brand entry point. The old Dark-Silk upload component
// (_components/floorplan-upload.tsx) is now unused.
export default function ProjectIndexRedirect() {
  redirect("/project/new");
}
