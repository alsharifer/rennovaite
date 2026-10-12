import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { VillaOrbit } from "./_components/villa-orbit";

export const metadata: Metadata = { title: "Villa orbit capture · RenovAIte", robots: { index: false, follow: false } };

// K6 — the stage the sign-in video is captured from (scripts/k6-capture-villa.mjs).
// Dev only, like /dev/blueprint: absent in production. A fictional villa, drawn
// by our own three.js — never a client project, never stock or AI imagery.
export default function VillaOrbitPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return (
    <main style={{ margin: 0, background: "#0b0d0f", minHeight: "100vh" }}>
      <VillaOrbit width={1280} height={900} />
    </main>
  );
}
