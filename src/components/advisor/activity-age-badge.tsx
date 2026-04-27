import { differenceInDays } from "date-fns";

// Color thresholds match the existing inactive-list bucket:
//   inactivity_days >= 14 already moves a client into the "Inactive Deals"
//   section (clients/page.tsx:111). Anything past 30 auto-declines.
function age_classes(days: number): { wrapper: string; dot: string; label: string } {
    if (days >= 30) return { wrapper: "bg-red-50 border-red-200 text-red-700", dot: "bg-red-500", label: "Stale" };
    if (days >= 14) return { wrapper: "bg-orange-50 border-orange-200 text-orange-700", dot: "bg-orange-500", label: "Inactive" };
    if (days >= 7)  return { wrapper: "bg-amber-50 border-amber-200 text-amber-700", dot: "bg-amber-500", label: "Cooling" };
    if (days >= 3)  return { wrapper: "bg-sky-50 border-sky-200 text-sky-700", dot: "bg-sky-500", label: "Recent" };
    return { wrapper: "bg-emerald-50 border-emerald-200 text-emerald-700", dot: "bg-emerald-500", label: "Fresh" };
}

interface ActivityAgeBadgeProps {
    /** ISO timestamps from the client_data_vault row. */
    created_at: string;
    last_activity_at?: string | null;
    /** "compact" omits the "Created … · " prefix when there's been no real activity yet. */
    variant?: "default" | "compact";
    className?: string;
}

/**
 * Shows the deal's age and how long since the last meaningful interaction.
 * If there's been no activity beyond creation, only the days-since-created is shown.
 */
export function ActivityAgeBadge({
    created_at,
    last_activity_at,
    variant = "default",
    className = "",
}: ActivityAgeBadgeProps) {
    const now = new Date();
    const created = new Date(created_at);
    const days_since_created = Math.max(0, differenceInDays(now, created));

    const last_activity = last_activity_at ? new Date(last_activity_at) : created;
    const days_since_activity = Math.max(0, differenceInDays(now, last_activity));

    // "No activity yet" = vault was created but nothing else has happened.
    const no_activity_yet =
        !last_activity_at || Math.abs(last_activity.getTime() - created.getTime()) < 60_000;

    // Color the chip by the more urgent of the two: idle time drives decay, but
    // a brand-new vault that hasn't moved in days is still worth nudging.
    const driving_days = no_activity_yet ? days_since_created : days_since_activity;
    const cls = age_classes(driving_days);

    const day_word = (n: number) => `${n}d`;
    const created_phrase = `${day_word(days_since_created)} in pipeline`;
    const activity_phrase = days_since_activity === 0
        ? "Active today"
        : `Last touch ${day_word(days_since_activity)} ago`;

    let main_text: React.ReactNode;
    if (no_activity_yet) {
        main_text = variant === "compact"
            ? <span>No replies · {day_word(days_since_created)}</span>
            : <span>{created_phrase} · No client activity</span>;
    } else {
        main_text = variant === "compact"
            ? <span>Active {day_word(days_since_activity)} ago</span>
            : <span>{created_phrase} · {activity_phrase}</span>;
    }

    return (
        <div
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls.wrapper} ${className}`}
            title={no_activity_yet
                ? `No client activity since vault was created on ${created.toLocaleDateString()} (${days_since_created} day${days_since_created === 1 ? "" : "s"} ago)`
                : `Created ${days_since_created}d ago · Last interaction ${days_since_activity}d ago`}
        >
            <span className={`h-1.5 w-1.5 rounded-full ${cls.dot}`} />
            <span className="font-bold opacity-70">{cls.label}</span>
            <span className="opacity-50">·</span>
            {main_text}
        </div>
    );
}
