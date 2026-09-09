import type { Metadata } from "next";

import { HomeLanding } from "@/components/marketing/home-landing";

export const metadata: Metadata = {
  title: "RennovAIte — AI renovation for Dubai villas",
  description:
    "RennovAIte turns your villa's floorplan into a tender-ready package: design renders, an itemised bill of quantities in AED, drawings and a permit check.",
};

// The RennovAIte marketing homepage's permanent route. `/` also renders this
// when PROPERTY_OS_LANDING is off; when it's on, `/` shows the Property OS
// intro and both its CTAs link here.
export default function RennovaitePage() {
  return <HomeLanding />;
}
