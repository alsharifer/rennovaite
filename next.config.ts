import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @napi-rs/canvas ships native `.node` binaries that Turbopack can't trace.
  // Mark it external so it's loaded via plain require at runtime.
  serverExternalPackages: ["@napi-rs/canvas"],
};

export default nextConfig;
