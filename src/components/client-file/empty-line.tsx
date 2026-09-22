// src/components/client-file/empty-line.tsx
import type React from "react";

/** One muted sentence. Counts live in the tiles, so empty states stay small. */
export function EmptyLine({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <p className="py-3 text-sm text-cb-ink/40">
      {children}
      {action && (
        <>
          <span aria-hidden className="mx-1.5 text-cb-ink/25">·</span>
          <button type="button" onClick={action.onClick} className="font-semibold text-emerald-700 hover:underline">
            {action.label}
          </button>
        </>
      )}
    </p>
  );
}
