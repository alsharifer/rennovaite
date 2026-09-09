"use client";

// Catches anything thrown below the root layout that a nearer boundary did not.
// Three lines on purpose — the implementation is shared (components/app/boundaries).
import { RouteError, type RouteErrorProps } from "@/components/app/boundaries";

export default function Error(props: RouteErrorProps) {
  return <RouteError {...props} />;
}
