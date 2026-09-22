// src/components/client-file/status-line.tsx
//
// One line replacing the activity-age pill and the stale-upload pill:
//   ● Urgent · 86d in pipeline · Last touch 19d ago · No uploads yet · 12d
// The state comes from getActivityState, the same classifier the pipeline
// filter and ActivityAgeBadge use, so the three never disagree.

import { Fragment } from "react";
import { differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import { getActivityState, type ActivityState } from "@/components/advisor/activity-age-badge";

const DOT: Record<ActivityState, string> = {
  Fresh: "bg-emerald-500",
  Alert: "bg-orange-500",
  Urgent: "bg-red-400",
  Stale: "bg-red-500",
};

const TEXT: Record<ActivityState, string> = {
  Fresh: "text-emerald-700",
  Alert: "text-orange-700",
  Urgent: "text-red-600",
  Stale: "text-red-700",
};

export function StatusLine({
  created_at,
  last_activity_at,
  reassigned_to_catch_all_at,
  upload_alert,
}: {
  created_at: string;
  last_activity_at?: string | null;
  reassigned_to_catch_all_at?: string | null;
  upload_alert?: string | null;
}) {
  const now = new Date();
  const created = new Date(created_at);
  const state = getActivityState(created_at, last_activity_at, reassigned_to_catch_all_at);
  const days_in_pipeline = Math.max(0, differenceInDays(now, created));
  const last = last_activity_at ? new Date(last_activity_at) : null;
  const no_activity_yet = !last || Math.abs(last.getTime() - created.getTime()) < 60_000;
  const idle_days = last ? Math.max(0, differenceInDays(now, last)) : days_in_pipeline;
  const touch = no_activity_yet ? "No client activity yet" : idle_days === 0 ? "Active today" : `Last touch ${idle_days}d ago`;

  const parts: { text: string; alert?: boolean }[] = [{ text: `${days_in_pipeline}d in pipeline` }, { text: touch }];
  if (upload_alert) parts.push({ text: upload_alert, alert: true });

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-cb-ink/50">
      <span className={cn("inline-flex items-center gap-1.5 font-semibold", TEXT[state])}>
        <span className={cn("h-1.5 w-1.5 rounded-full", DOT[state], state !== "Fresh" && "animate-pulse")} />
        {state}
      </span>
      {parts.map((part) => (
        <Fragment key={part.text}>
          <span aria-hidden className="text-cb-ink/25">·</span>
          <span className={part.alert ? "font-medium text-red-600" : undefined}>{part.text}</span>
        </Fragment>
      ))}
    </p>
  );
}
