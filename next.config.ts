import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native `.node` binaries Turbopack can't trace — load via plain require at
  // runtime. @resvg/resvg-js rasterises drawing SVGs for the P1 PDF export.
  serverExternalPackages: ["@napi-rs/canvas", "@resvg/resvg-js"],
  experimental: {
    // Next 16 buffers a cloneable request body capped at this size when a
    // proxy/middleware is present; the default (10 MB) would silently truncate
    // an image upload if a proxy is later added. Keep it above the room-photo
    // route's 20 MB backstop so uploads are size-checked in the handler (→ a
    // structured 413) rather than corrupted by truncation. Client-side
    // compression keeps real uploads far under this.
    proxyClientMaxBodySize: "25mb",
  },
};

export default nextConfig;
