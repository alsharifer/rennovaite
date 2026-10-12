import { notFound } from "next/navigation";
import { z } from "zod";

import { FirmBook } from "./_components/firm-book";

export const dynamic = "force-dynamic";

// U2 — /firms/:firmId: one firm's rate book, for its members. The reads (the
// SAME store functions the API uses, with the same caller, so a non-member gets
// the 403 card and never a byte of the book) live in FirmBook, which the
// project's step 04 (/project/[id]/rates) renders too.
export default async function FirmBookPage({ params, searchParams }: { params: Promise<{ firmId: string }>; searchParams: Promise<{ add?: string }> }) {
  const { firmId } = await params;
  const { add } = await searchParams;
  if (!z.string().uuid().safeParse(firmId).success) notFound();
  return <FirmBook firmId={firmId} startAdding={!!add} />;
}
