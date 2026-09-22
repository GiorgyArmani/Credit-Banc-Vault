// src/components/client-file/client-file-shell.tsx
//
// Frame for every staff client file: header, summary tiles, then a work column
// of tabs beside a context rail. The same grammar as the client portal
// (src/app/dashboard/page.tsx). Presentational only: portals build the slots.
//
// The rail is a normal column, not sticky: it is taller than a laptop viewport,
// and a sticky rail taller than the viewport hides its lower cards (or needs
// an inner scrollbar, which clipped them instead).
//
// The rail is optional. Pass `rail={null}` and the work column spans the full
// width instead of leaving an empty 320px track — a tab such as the Review
// workbench needs every pixel it can get for the document preview.

import type React from "react";

export function ClientFileShell({
  header,
  tiles,
  tabs,
  rail,
}: {
  header: React.ReactNode;
  tiles: React.ReactNode;
  tabs: React.ReactNode;
  rail?: React.ReactNode;
}) {
  const has_rail = rail !== null && rail !== undefined;

  return (
    <div className="space-y-5">
      {header}
      {tiles}
      {has_rail ? (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">{tabs}</div>
          <aside className="space-y-4 self-start">{rail}</aside>
        </div>
      ) : (
        <div className="min-w-0">{tabs}</div>
      )}
    </div>
  );
}
