// src/app/partner/dashboard/_components/partner-progress.tsx
//
// The progress SIGNAL a referral partner sees — deliberately not the pipeline.
// Five dots and a label, no dates, no notes, no lender, no "who moved it".
// Server-rendered: there is nothing interactive here on purpose, because every
// affordance invites a partner to act on internal state that isn't theirs.

import clsx from "clsx";
import {
  PARTNER_STAGES,
  partnerStageFor,
  type PartnerStage,
} from "@/lib/partner-pipeline";

const TONE: Record<PartnerStage["tone"], { text: string; dot: string; track: string }> = {
  neutral: { text: "text-cb-ink/60", dot: "bg-cb-gray/50", track: "bg-cb-gray/40" },
  active: { text: "text-cb-ink", dot: "bg-cb-mint", track: "bg-cb-mint" },
  won: { text: "text-cb-mint", dot: "bg-cb-mint", track: "bg-cb-mint" },
  lost: { text: "text-cb-ink/40", dot: "bg-cb-gray/30", track: "bg-cb-gray/30" },
};

export function PartnerProgress({ status }: { status: string | null | undefined }) {
  const stage = partnerStageFor(status);
  const tone = TONE[stage.tone];
  const isOffRamp = stage.step <= 0;

  return (
    <div className="min-w-[190px]">
      <div className="flex items-center gap-1.5" role="img" aria-label={`Stage: ${stage.label}`}>
        {PARTNER_STAGES.map((s) => {
          const reached = !isOffRamp && s.step <= stage.step;
          return (
            <span
              key={s.step}
              className={clsx(
                "h-1.5 flex-1 rounded-full transition-colors",
                reached ? tone.track : "bg-black/[0.07]"
              )}
            />
          );
        })}
      </div>
      <p className={clsx("mt-2 text-xs font-bold tracking-tight", tone.text)}>
        {stage.label}
        {!isOffRamp && (
          <span className="ml-1.5 font-medium text-cb-ink/35">
            {stage.step}/{PARTNER_STAGES.length}
          </span>
        )}
      </p>
    </div>
  );
}

/** Compact pill for the same signal, used where a full bar doesn't fit. */
export function PartnerStagePill({ status }: { status: string | null | undefined }) {
  const stage = partnerStageFor(status);
  const cls =
    stage.tone === "won"
      ? "bg-cb-mint/10 text-cb-mint"
      : stage.tone === "lost"
        ? "bg-cb-gray/10 text-cb-gray"
        : stage.tone === "active"
          ? "bg-blue-50 text-blue-600"
          : "bg-amber-50 text-amber-600";

  return (
    <span
      className={clsx(
        "inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide",
        cls
      )}
    >
      {stage.label}
    </span>
  );
}
