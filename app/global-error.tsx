"use client";

// The last resort: the ROOT LAYOUT itself failed, so there is no layout left to
// render inside and this must supply its own <html>/<body>. Deliberately plain
// — it cannot rely on fonts, providers or the design system, because whatever
// broke may be exactly those.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F7F3EC",
          color: "#0F1B2D",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: 520 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: "0 0 12px" }}>
            RennovAIte didn&apos;t load.
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "#334155", margin: "0 0 24px" }}>
            Something failed before the page could start. Your projects and
            figures are unaffected.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              height: 44,
              padding: "0 24px",
              borderRadius: 8,
              border: "none",
              background: "#A4793A",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: 20, fontSize: 12, color: "#64748b", fontFamily: "monospace" }}>
              Reference {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
