import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native `.node` binaries Turbopack can't trace — load via plain require at
  // runtime. @resvg/resvg-js rasterises drawing SVGs for the P1 PDF export.
  // mupdf is a ~14 MB WASM build (not native, but bundling it would inline the
  // .wasm); it reads the CAD text and vector layers out of an uploaded plan PDF
  // so the parse can crop to the drawing. lib/parse/sheet/pdf.ts imports it
  // lazily, so a raster or photo parse never loads it at all.
  serverExternalPackages: ["@napi-rs/canvas", "@resvg/resvg-js", "mupdf"],
  // (H9 removed experimental.proxyClientMaxBodySize: no request body carries a
  // file any more — uploads go straight to Storage on a signed URL — so there is
  // no upload body for the proxy to buffer or truncate.)
};

export default nextConfig;
