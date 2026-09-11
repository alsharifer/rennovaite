import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native `.node` binaries Turbopack can't trace — load via plain require at
  // runtime. @resvg/resvg-js rasterises drawing SVGs for the P1 PDF export.
  // mupdf is a ~14 MB WASM build (not native, but bundling it would inline the
  // .wasm); it reads the CAD text and vector layers out of an uploaded plan PDF
  // so the parse can crop to the drawing. lib/parse/sheet/pdf.ts imports it
  // lazily, so a raster or photo parse never loads it at all.
  serverExternalPackages: ["@napi-rs/canvas", "@resvg/resvg-js", "mupdf"],
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
