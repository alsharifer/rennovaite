import { RouteNotFound } from "@/components/app/boundaries";

export default function NotFound() {
  return (
    <RouteNotFound
      title="We couldn't find that project."
      body="It may have been removed, or the link may be pointing at a project on a different account."
    />
  );
}
