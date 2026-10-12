import { redirectToProjectsHome } from "@/lib/auth/front-door";

// K8 (spec §6.1): the Projects home (/projects) replaces this route.
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return redirectToProjectsHome(searchParams);
}
