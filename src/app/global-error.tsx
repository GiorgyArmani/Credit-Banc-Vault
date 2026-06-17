"use client";

// src/app/global-error.tsx
//
// Last-resort boundary for crashes in the ROOT layout itself (where even
// app/error.tsx can't render). It must provide its own <html>/<body> and can't
// rely on app providers or global CSS, so everything here is inline-styled.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  const report = [
    "[Credit Banc Vault fatal crash]",
    error.digest ? `Digest: ${error.digest}` : null,
    `Message: ${error.message || "Unknown error"}`,
    error.stack ? `\nStack:\n${error.stack}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fef2f2",
          fontFamily:
            "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "1rem",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: "2rem",
            boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
            maxWidth: "32rem",
            width: "100%",
            padding: "2.5rem",
            border: "1px solid #fee2e2",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: "3rem",
              lineHeight: 1,
              marginBottom: "1rem",
            }}
            aria-hidden
          >
            ⚠️
          </div>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 900,
              color: "#450a0a",
              textTransform: "uppercase",
              letterSpacing: "-0.03em",
              margin: "0 0 0.5rem",
            }}
          >
            The app hit a fatal error
          </h1>
          <p
            style={{
              color: "rgba(69,10,10,0.45)",
              fontWeight: 700,
              margin: "0 0 1.5rem",
            }}
          >
            Try again, or copy the details below and send them to support.
          </p>

          <pre
            style={{
              background: "rgba(254,242,242,0.6)",
              border: "1px solid #fee2e2",
              borderRadius: "1rem",
              padding: "1rem",
              textAlign: "left",
              fontSize: "0.8rem",
              color: "#450a0a",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              userSelect: "all",
              margin: "0 0 1.5rem",
              maxHeight: "12rem",
              overflow: "auto",
            }}
          >
            {report}
          </pre>

          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            <a
              href={`mailto:support@creditbanc.io?subject=${encodeURIComponent(
                `Vault fatal crash ${error.digest || ""}`.trim()
              )}&body=${encodeURIComponent(report)}`}
              style={{
                flex: "1 1 10rem",
                height: "3.25rem",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid #fee2e2",
                color: "#450a0a",
                fontWeight: 900,
                borderRadius: "1rem",
                textDecoration: "none",
              }}
            >
              Email support
            </a>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                flex: "1 1 10rem",
                height: "3.25rem",
                background: "#ef4444",
                color: "#fff",
                fontWeight: 900,
                border: "none",
                borderRadius: "1rem",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
