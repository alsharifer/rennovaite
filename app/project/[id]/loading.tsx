import { ShellSkeleton } from "@/components/blueprint/shell/ShellSkeleton";

// K2: the project hub frames itself (it sits at the [id] level), so while it
// loads the chrome is drawn as a skeleton — rail, top bar and rows — rather
// than the page disappearing. Every child segment has its own loading.tsx.
export default function Loading() {
  return <ShellSkeleton what="the project" />;
}
