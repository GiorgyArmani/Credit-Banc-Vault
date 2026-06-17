import { differenceInDays } from "date-fns";

// The activity-decay states a deal card can be in, freshest → most overdue.
export type ActivityState = "Fresh" | "Alert" | "Urgent" | "Stale";

// Order used for the pipeline filter dropdown (most urgent first reads better there).
export const ACTIVITY_STATES: ActivityState[] = ["Stale", "Urgent", "Alert", "Fresh"];

// Auto-reassignment fires at 7 days of no activity (reassign-stale-files cron).
const REASSIGN_AFTER_DAYS = 7;

// Idle-day bands for files NOT (yet) reassigned to the catch-all advisor.
// "Stale" is intentionally excluded here — it's a post-reassignment state
// layered on by getActivityState() below.
function ageBandForDays(days: number): Exclude<ActivityState, "Stale"> {
    if (days >= REASSIGN_AFTER_DAYS) return "Urgent"; // due for / past auto-reassign
    if (days >= 5)                   return "Alert";  // approaching auto-reassign
    return "Fresh";
}

// Days that drive the chip's color: idle time normally, or days-since-created
// when nothing has happened beyond creation. Exported so the pipeline
// activity-state filter classifies cards exactly the way this badge renders.
export function activityDrivingDays(created_at: string, last_activity_at?: string | null): number {
    const now = new Date();
    const created = new Date(created_at);
    const days_since_created = Math.max(0, differenceInDays(now, created));
    const last_activity = last_activity_at ? new Date(last_activity_at) : created;
    const days_since_activity = Math.max(0, differenceInDays(now, last_activity));
    const no_activity_yet =
        !last_activity_at || Math.abs(last_activity.getTime() - created.getTime()) < 60_000;
    return no_activity_yet ? days_since_created : days_since_activity;
}

/**
 * Classifies a deal's activity state.
 *
 * "Stale" is special: a file is only Stale once it has been reassigned to the
 * catch-all advisor (reassigned_to_catch_all_at is set) AND has had no activity
 * for another 7 days since — i.e. even the catch-all advisor hasn't moved it.
 * Everything else is graded purely on idle time (Fresh / Alert / Urgent).
 */
export function getActivityState(
    created_at: string,
    last_activity_at?: string | null,
    reassigned_to_catch_all_at?: string | null,
): ActivityState {
    if (reassigned_to_catch_all_at) {
        const now = new Date();
        const reassigned = new Date(reassigned_to_catch_all_at);
        const last_activity = last_activity_at ? new Date(last_activity_at) : new Date(created_at);
        // Measure from whichever is later: the reassignment, or any activity since.
        const ref = last_activity > reassigned ? last_activity : reassigned;
        if (differenceInDays(now, ref) >= REASSIGN_AFTER_DAYS) return "Stale";
    }
    return ageBandForDays(activityDrivingDays(created_at, last_activity_at));
}

// Plain-language explanation of each activity state, for the pipeline legend.
// Keep day ranges in sync with ageBandForDays() + getActivityState() above.
export const ACTIVITY_STATE_LEGEND: { state: ActivityState; dot: string; description: string }[] = [
    { state: "Fresh",  dot: "bg-emerald-500", description: "Activity within the last 4 days." },
    { state: "Alert",  dot: "bg-orange-500",  description: "No activity for 5–6 days — auto-reassign nears at 7." },
    { state: "Urgent", dot: "bg-red-400",     description: "No activity for 7+ days — due for auto-reassign to the catch-all advisor." },
    { state: "Stale",  dot: "bg-red-500",     description: "Reassigned to the catch-all advisor and still untouched for 7+ days." },
];

const STATE_STYLES: Record<ActivityState, { wrapper: string; dot: string }> = {
    Stale:  { wrapper: "bg-red-50 border-red-200 text-red-700", dot: "bg-red-500" },
    Urgent: { wrapper: "bg-red-50 border-red-200 text-red-600", dot: "bg-red-400" },
    Alert:  { wrapper: "bg-orange-50 border-orange-200 text-orange-700", dot: "bg-orange-500" },
    Fresh:  { wrapper: "bg-emerald-50 border-emerald-200 text-emerald-700", dot: "bg-emerald-500" },
};

interface ActivityAgeBadgeProps {
    /** ISO timestamps from the client_data_vault row. */
    created_at: string;
    last_activity_at?: string | null;
    /** Set when the file was handed to the catch-all advisor — drives the "Stale" state. */
    reassigned_to_catch_all_at?: string | null;
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
    reassigned_to_catch_all_at,
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

    const state = getActivityState(created_at, last_activity_at, reassigned_to_catch_all_at);
    const cls = { ...STATE_STYLES[state], label: state };

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
