"use client";

import { RouteError, type RouteErrorProps } from "@/components/app/boundaries";

export default function Error(props: RouteErrorProps) {
  return <RouteError {...props} />;
}
