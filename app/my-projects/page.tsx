import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

// /my-projects was merged into /dashboard (G1). Permanent redirect, preserving
// any filter/sort/view query params so old deep links land on the same view.
export default async function MyProjectsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v != null) qs.set(k, v);
  }
  const query = qs.toString();
  permanentRedirect(query ? `/dashboard?${query}` : "/dashboard");
}
