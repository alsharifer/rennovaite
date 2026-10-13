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

  // K9: the document TTFs (lib/documents/doc-fonts.ts) are read from disk by resvg
  // at render time, so the routes that rasterise a document must ship them.
  outputFileTracingIncludes: {
    "/api/projects/[id]/boq-pdf": ["./lib/documents/fonts/**"],
    "/api/projects/[id]/proposal": ["./lib/documents/fonts/**"],
    "/api/projects/[id]/boq-diff": ["./lib/documents/fonts/**"],
    "/api/projects/[id]/drawings": ["./lib/documents/fonts/**"],
    "/api/projects/[id]/render-pack": ["./lib/documents/fonts/**"],
  },

  // K8 (spec §6.0): 02 Design is one route. The old step routes are gone for
  // good, so these are permanent (308; query strings pass through). They run
  // before proxy.ts, which then checks membership on /design itself.
  async redirects() {
    return [
      { source: "/project/:id/ideation", destination: "/project/:id/design", permanent: true },
      { source: "/project/:id/style", destination: "/project/:id/design", permanent: true },
      { source: "/project/:id/moodboard", destination: "/project/:id/design?view=references", permanent: true },
      // K8 review (13 Oct): Marketplace and Community have no page — cut from
      // navigation since K2, no frame in J6. Temporary (307), so either can come
      // back; the destination is SIGNED_IN_HOME (lib/auth/link-error.ts).
      { source: "/marketplace", destination: "/projects", permanent: false },
      { source: "/community", destination: "/projects", permanent: false },
    ];
  },
};

export default nextConfig;
