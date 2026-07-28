import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native `.node` binaries Turbopack can't trace — load via plain require at
  // runtime. @resvg/resvg-js rasterises drawing SVGs for the P1 PDF export.
  serverExternalPackages: ["@napi-rs/canvas", "@resvg/resvg-js"],
};

export default nextConfig;
