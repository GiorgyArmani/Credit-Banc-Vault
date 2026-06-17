"use client";

import { useState } from "react";
import { Loader2, PauseCircle, PlayCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { setReassignmentPause } from "../actions";
import { toast } from "@/lib/toast";
import clsx from "clsx";

interface ReassignmentPauseControlProps {
    clientId: string;
    /** Current reassignment_paused_until (ISO) or null. */
    paused_until: string | null;
    /** Compact icon-only trigger for tight spots like pipeline cards. */
    compact?: boolean;
}

const PRESETS: { label: string; days: number }[] = [
    { label: "1 week", days: 7 },
    { label: "2 weeks", days: 14 },
    { label: "30 days", days: 30 },
];

function format_date(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Lets an advisor/admin pause the 7-day auto-reassignment of a file to the
 * catch-all advisor (e.g. a client asked for more time). Presets + Resume.
 */
export function ReassignmentPauseControl({ clientId, paused_until, compact = false }: ReassignmentPauseControlProps) {
    const [pausedUntil, setPausedUntil] = useState<string | null>(paused_until);
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);

    const is_paused = !!pausedUntil && new Date(pausedUntil) > new Date();

    async function apply(pauseDays: number | null) {
        setBusy(true);
        try {
            const result = await setReassignmentPause(clientId, pauseDays);
            if (result.success) {
                setPausedUntil(result.paused_until ?? null);
                setOpen(false);
                toast.success(
                    pauseDays
                        ? `Auto-reassign paused for ${pauseDays === 7 ? "1 week" : pauseDays === 14 ? "2 weeks" : `${pauseDays} days`}`
                        : "Auto-reassign resumed"
                );
            } else {
                toast.error(result.error || "Failed to update pause");
            }
        } catch {
            toast.error("An unexpected error occurred");
        } finally {
            setBusy(false);
        }
    }

    // Compact: a single icon-button + popover, for tight spots (pipeline cards).
    if (compact) {
        return (
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        onClick={(e) => e.stopPropagation()}
                        disabled={busy}
                        title={is_paused
                            ? `Auto-reassign paused until ${format_date(pausedUntil!)}`
                            : "Pause auto-reassign"}
                        className={clsx(
                            "flex-shrink-0 p-0.5 rounded-lg transition-colors disabled:opacity-50",
                            is_paused
                                ? "text-sky-500 hover:text-sky-700 bg-sky-50 dark:bg-sky-950/30"
                                : "text-slate-300 hover:text-sky-600 bg-slate-50 dark:bg-slate-800"
                        )}
                    >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-52 p-1.5" align="end" onClick={(e) => e.stopPropagation()}>
                    {is_paused ? (
                        <>
                            <p className="px-2 py-1 text-[11px] text-slate-500">
                                Auto-reassign paused until <span className="font-semibold text-slate-700">{format_date(pausedUntil!)}</span>
                            </p>
                            <button
                                onClick={() => apply(null)}
                                disabled={busy}
                                className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                            >
                                <PlayCircle className="h-4 w-4" /> Resume now
                            </button>
                        </>
                    ) : (
                        <>
                            <p className="px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Pause auto-reassign for…</p>
                            {PRESETS.map((p) => (
                                <button
                                    key={p.days}
                                    onClick={() => apply(p.days)}
                                    disabled={busy}
                                    className="w-full text-left px-2 py-1.5 rounded-md text-sm font-medium text-slate-700 hover:bg-sky-50 hover:text-sky-700 disabled:opacity-50"
                                >
                                    {p.label}
                                </button>
                            ))}
                        </>
                    )}
                </PopoverContent>
            </Popover>
        );
    }

    if (is_paused) {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-700">
                <PauseCircle className="h-3.5 w-3.5" />
                Auto-reassign paused · until {format_date(pausedUntil!)}
                <button
                    onClick={() => apply(null)}
                    disabled={busy}
                    className="ml-1 inline-flex items-center gap-1 text-sky-600 hover:text-sky-900 disabled:opacity-50"
                    title="Resume auto-reassignment now"
                >
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                    Resume
                </button>
            </span>
        );
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    disabled={busy}
                    title="Pause auto-reassignment to the catch-all advisor"
                    className={clsx(
                        "inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:border-sky-300 hover:text-sky-700 transition-colors disabled:opacity-50"
                    )}
                >
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <PauseCircle className="h-3.5 w-3.5" />}
                    Pause auto-reassign
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1.5" align="start">
                <p className="px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Pause for…</p>
                {PRESETS.map((p) => (
                    <button
                        key={p.days}
                        onClick={() => apply(p.days)}
                        disabled={busy}
                        className="w-full text-left px-2 py-1.5 rounded-md text-sm font-medium text-slate-700 hover:bg-sky-50 hover:text-sky-700 disabled:opacity-50"
                    >
                        {p.label}
                    </button>
                ))}
            </PopoverContent>
        </Popover>
    );
}
