// src/components/client-file/summary-tiles.tsx
import { cn } from "@/lib/utils";

export type SummaryTile = { id: string; label: string; value: string; tone?: "default" | "positive" };

// Static class names so Tailwind's scanner keeps them.
const LG_COLS: Record<number, string> = {
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

// The grid is gap-px over a grey backing, so a short last row shows grey
// holes. The last tile stretches to fill its row: on the 2-col phone grid an
// odd count spans 2; on the 3-col sm grid it spans whatever the last row is
// missing. lg fits every tile (up to 6) in one row, so it resets to 1.
// Static strings so Tailwind's scanner keeps them. Today the file always
// renders 5 tiles: "col-span-2 sm:col-span-2 lg:col-span-1".
const LAST_TILE_SPAN: Record<number, string> = {
  1: "col-span-2 sm:col-span-3 lg:col-span-1",
  2: "sm:col-span-2 lg:col-span-1",
  3: "col-span-2 sm:col-span-1",
  4: "sm:col-span-3 lg:col-span-1",
  5: "col-span-2 sm:col-span-2 lg:col-span-1",
  6: "",
};

export function SummaryTiles({ tiles }: { tiles: SummaryTile[] }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-black/5 bg-black/5 shadow-sm sm:grid-cols-3",
        LG_COLS[tiles.length] ?? "lg:grid-cols-6",
      )}
    >
      {tiles.map((tile, index) => (
        <div
          key={tile.id}
          className={cn("bg-white px-4 py-3.5", index === tiles.length - 1 && LAST_TILE_SPAN[tiles.length])}
        >
          <p
            className={cn(
              "font-manrope text-xl font-extrabold tracking-tight tabular-nums",
              tile.value === "—" ? "text-cb-ink/25" : tile.tone === "positive" ? "text-emerald-700" : "text-cb-ink",
            )}
          >
            {tile.value}
          </p>
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-cb-gray">{tile.label}</p>
        </div>
      ))}
    </div>
  );
}
