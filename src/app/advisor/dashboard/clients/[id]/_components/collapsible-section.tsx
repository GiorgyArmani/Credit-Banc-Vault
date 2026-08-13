// src/app/advisor/dashboard/clients/[id]/_components/collapsible-section.tsx
//
// Wraps a section of the client detail page with a thin clickable header that
// toggles a Radix Collapsible. Open/closed state persists to localStorage so
// each user's preference per (client, section) survives a reload.
//
// The wrapper IS the section card: it renders the single bordered container and
// its clickable header (title + chevron). Children are the bare body — they must
// NOT carry their own border or repeat the title, or the section reads as a
// card-in-card with a duplicated name.
//
// Listens for a `client-detail:toggle-all` window event to support the
// page-level Expand/Collapse-all pill.

"use client";

import { ReactNode, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import clsx from "clsx";

// Open string so each page can define its own slugs. The slug is only used to
// namespace the localStorage key — the wrapper doesn't care about the value.
export type SectionSlug = string;

interface CollapsibleSectionProps {
    /** Used to namespace the localStorage key — pass the client vault id. */
    clientId: string;
    /** Stable identifier for this section (per page). */
    slug: SectionSlug;
    title: string;
    /** Optional one-line summary shown next to the title when collapsed. */
    summary?: ReactNode;
    /** Optional badge / pill rendered to the right of the title (always visible). */
    accessory?: ReactNode;
    defaultOpen?: boolean;
    children: ReactNode;
}

const STORAGE_PREFIX = "cb-client-section";
const TOGGLE_ALL_EVENT = "client-detail:toggle-all";

export interface ToggleAllDetail {
    open: boolean;
}

export function CollapsibleSection({
    clientId,
    slug,
    title,
    summary,
    accessory,
    defaultOpen = true,
    children,
}: CollapsibleSectionProps) {
    const storage_key = `${STORAGE_PREFIX}:${clientId}:${slug}`;
    // Start with `defaultOpen` so server- and first-client-render agree. Hydrate
    // the stored preference in an effect to avoid an SSR/CSR mismatch warning.
    const [is_open, set_is_open] = useState<boolean>(defaultOpen);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const raw = window.localStorage.getItem(storage_key);
            if (raw === "open") set_is_open(true);
            else if (raw === "closed") set_is_open(false);
        } catch {
            // localStorage can throw in private-browsing modes — fall back silently.
        }
    }, [storage_key]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            window.localStorage.setItem(storage_key, is_open ? "open" : "closed");
        } catch {
            // ignore
        }
    }, [storage_key, is_open]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<ToggleAllDetail>).detail;
            if (detail && typeof detail.open === "boolean") set_is_open(detail.open);
        };
        window.addEventListener(TOGGLE_ALL_EVENT, handler);
        return () => window.removeEventListener(TOGGLE_ALL_EVENT, handler);
    }, []);

    return (
        <Collapsible open={is_open} onOpenChange={set_is_open}>
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                {/* Header row: the trigger (chevron + title) toggles; the accessory
                    sits beside it as a sibling so its buttons stay valid (no nested
                    <button>) and don't toggle the section when clicked. */}
                {/* flex-wrap, because the accessory is `shrink-0` while the
                    trigger beside it is `flex-1 min-w-0`: once the buttons get
                    wide enough, the trigger collapses but the title inside it
                    does not, and the two render on top of each other. Wrapping
                    drops the button row to its own line instead — which is also
                    the right behaviour on a narrow viewport. */}
                <div
                    className={clsx(
                        "flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5",
                        is_open && "border-b border-slate-100",
                    )}
                >
                    <CollapsibleTrigger asChild>
                        {/* shrink-0, NOT flex-1. With flex-1 min-w-0 the flex
                            algorithm collapses this button toward zero rather
                            than wrapping the accessory — and the title inside is
                            shrink-0, so it overflows the collapsed box and paints
                            straight through the buttons. Refusing to shrink is
                            what actually makes flex-wrap fire. */}
                        <button
                            type="button"
                            className="group flex shrink-0 items-center gap-3 text-left hover:opacity-80 transition-opacity"
                            aria-expanded={is_open}
                        >
                            <ChevronDown
                                className={clsx(
                                    "h-3.5 w-3.5 text-slate-400 shrink-0 transition-transform",
                                    is_open ? "rotate-0" : "-rotate-90",
                                )}
                            />
                            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 shrink-0">
                                {title}
                            </span>
                            {summary && !is_open && (
                                <span className="text-[11px] font-bold text-slate-400 truncate min-w-0">
                                    {summary}
                                </span>
                            )}
                        </button>
                    </CollapsibleTrigger>
                    {accessory && (
                        <div className="ml-auto shrink-0 flex items-center gap-2">{accessory}</div>
                    )}
                </div>
                <CollapsibleContent>{children}</CollapsibleContent>
            </div>
        </Collapsible>
    );
}

/**
 * Broadcasts an "expand all" / "collapse all" intent to every
 * `<CollapsibleSection>` mounted on the page.
 */
export function broadcast_toggle_all(open: boolean) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
        new CustomEvent<ToggleAllDetail>(TOGGLE_ALL_EVENT, { detail: { open } }),
    );
}
