// The landing page's feature grid: four things the vault does, each shown as
// the piece of vault UI that does it rather than as an icon and a paragraph.
//
// Every fragment depicts a real behaviour — bank statements grouped by account
// (last four digits only), advisor approval or a returned document with its
// reason, in-app status notices, one tab per business. The names and figures
// inside them are a plausible file, not anyone's data.
//
// Layout is a 3-column bento: wide + narrow, then narrow + wide, so the two
// rows never repeat a shape.

import { Bell, Check, CornerDownRight, FileText, RotateCcw } from "lucide-react";

const CARD =
  "group flex h-full flex-col overflow-hidden rounded-2xl border border-black/5 bg-cb-cream transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-40px_rgba(0,3,33,0.45)]";
const PANEL = "flex flex-1 flex-col justify-center gap-2 px-6 pt-6 sm:px-7 sm:pt-7";
const TEXT = "px-6 pb-6 pt-5 sm:px-7 sm:pb-7";
const TITLE = "font-headline text-xl font-extrabold tracking-tight text-cb-navy";
const BODY = "mt-2 text-[15px] leading-relaxed text-on-surface-variant";
const TAG = "font-label text-[9px] font-bold uppercase tracking-[0.16em]";

function Meter({ value, total }: { value: number; total: number }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-cb-navy/10">
      <span
        className="block h-full origin-left rounded-full bg-cb-mint"
        style={{ transform: `scaleX(${value / total})` }}
      />
    </span>
  );
}

function AccountRow({ account, value, total }: { account: string; value: number; total: number }) {
  const full = value === total;
  return (
    <div className="rounded-xl border border-black/5 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-bold text-cb-navy tabular-nums">{account}</span>
        <span className={`shrink-0 tabular-nums ${TAG} ${full ? "text-on-primary-container" : "text-cb-gray"}`}>
          {value} of {total} months
        </span>
      </div>
      <div className="mt-2.5">
        <Meter value={value} total={total} />
      </div>
    </div>
  );
}

export function VaultFeatureGrid() {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* 1 — sorting. Wide. */}
      <article className={`${CARD} lg:col-span-2`}>
        <div className={PANEL}>
          <p className={`${TAG} text-cb-gray`}>Bank statements</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <AccountRow account="Checking ••4821" value={12} total={12} />
            <AccountRow account="Savings ••0937" value={9} total={12} />
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-cb-navy/20 px-4 py-3 text-sm text-on-surface-variant">
            <FileText className="h-4 w-4 shrink-0 text-cb-gray" />
            <span className="truncate">statement-march.pdf</span>
            <CornerDownRight className="h-4 w-4 shrink-0 text-cb-mint" />
            <span className="shrink-0 font-bold text-cb-navy tabular-nums">Savings ••0937</span>
          </div>
        </div>
        <div className={TEXT}>
          <h3 className={TITLE}>Sorts each upload by category</h3>
          <p className={BODY}>
            Drop files in and the vault files them. Bank statements group by account, so twelve months stay together.
          </p>
        </div>
      </article>

      {/* 2 — review. */}
      <article className={CARD}>
        <div className={PANEL}>
          <div className="flex items-center gap-3 rounded-xl border border-cb-mint/30 bg-cb-mint/[0.08] px-4 py-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cb-mint text-cb-navy">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-bold text-cb-navy">Voided check</span>
            <span className={`${TAG} text-on-primary-container`}>Approved</span>
          </div>
          <div className="rounded-xl border border-black/5 bg-white px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cb-cream text-cb-navy">
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.5} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-cb-navy">Driver&rsquo;s license</span>
              <span className={`${TAG} text-cb-navy/70`}>New copy</span>
            </div>
            <p className="mt-2.5 border-l-2 border-cb-mint pl-3 text-[13px] leading-snug text-on-surface-variant">
              The back of the card is missing.
            </p>
          </div>
        </div>
        <div className={TEXT}>
          <h3 className={TITLE}>Reviews every document</h3>
          <p className={BODY}>Your advisor approves each file or returns it with the reason attached.</p>
        </div>
      </article>

      {/* 3 — status notices. */}
      <article className={CARD}>
        <div className={PANEL}>
          {[
            { text: "Tax returns approved", when: "2 min", fresh: true },
            { text: "Profit & loss requested", when: "1 hr", fresh: false },
            { text: "File moved to In review", when: "Tue", fresh: false },
          ].map((n) => (
            <div key={n.text} className="flex items-center gap-3 rounded-xl border border-black/5 bg-white px-4 py-3">
              <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cb-cream text-cb-navy">
                <Bell className="h-3.5 w-3.5" />
                {n.fresh && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-cb-mint motion-safe:animate-pulse" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-cb-navy">{n.text}</span>
              <span className="shrink-0 text-xs text-cb-gray tabular-nums">{n.when}</span>
            </div>
          ))}
        </div>
        <div className={TEXT}>
          <h3 className={TITLE}>Reports each status change</h3>
          <p className={BODY}>Approvals, new requests and stage changes appear in your vault as they happen.</p>
        </div>
      </article>

      {/* 4 — multi-business. Wide. */}
      <article className={`${CARD} lg:col-span-2`}>
        <div className={PANEL}>
          <div className="flex gap-1.5 rounded-xl bg-cb-navy/[0.06] p-1.5">
            <span className="flex-1 truncate rounded-lg bg-white px-3 py-2 text-center text-sm font-bold text-cb-navy shadow-sm">
              Harbor Cafe LLC
            </span>
            <span className="flex-1 truncate rounded-lg px-3 py-2 text-center text-sm font-bold text-cb-navy/50">
              Harbor Catering
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-black/5 bg-white px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className={`${TAG} text-cb-gray`}>Checklist</span>
                <span className="text-sm font-bold text-cb-navy tabular-nums">6 of 6</span>
              </div>
              <div className="mt-2.5">
                <Meter value={6} total={6} />
              </div>
            </div>
            <div className="rounded-xl border border-black/5 bg-white px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className={`${TAG} text-cb-gray`}>Funding status</span>
                <span className="flex items-center gap-1.5 text-sm font-bold text-cb-navy">
                  <span className="h-2 w-2 rounded-full bg-cb-mint" />
                  In review
                </span>
              </div>
              <div className="mt-2.5">
                <Meter value={3} total={5} />
              </div>
            </div>
          </div>
        </div>
        <div className={TEXT}>
          <h3 className={TITLE}>Keeps each business separate</h3>
          <p className={BODY}>
            Own more than one company? Each gets its own tab, its own checklist and its own funding status.
          </p>
        </div>
      </article>
    </div>
  );
}
