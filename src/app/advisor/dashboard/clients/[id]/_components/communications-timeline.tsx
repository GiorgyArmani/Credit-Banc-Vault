// src/app/advisor/dashboard/clients/[id]/_components/communications-timeline.tsx
//
// The client's contact history — every call, text and email in one feed
// (M2 / Communications Hub, Phase 1).
//
// Distinct from <InternalCommunication />, which is staff-to-staff notes ABOUT
// the client. This is contact WITH the client. Keeping them apart matters: "we
// discussed this internally" and "we actually reached them" are different facts,
// and only the second one should reset a stale file's clock.
//
// Self-fetching, like <AdminLenderReviewCard />, so mounting it costs the parent
// page nothing but one line.
//
// Until the Telzio and Mailgun integrations land (Phases 2-3) the only writer is
// the rep: the Call / Text buttons hand off to the device that can actually
// place the call, then open the log form pre-filled so the record still gets
// made. Those buttons become in-app actions later without the feed changing.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Phone,
    PhoneIncoming,
    PhoneOutgoing,
    PhoneMissed,
    MessageSquare,
    Mail,
    Loader2,
    Plus,
    Trash2,
    Bot,
    X,
    Reply,
} from "lucide-react";
import { format } from "date-fns";
import clsx from "clsx";
import { toast } from "@/lib/toast";
import {
    listCommunications,
    logManualContact,
    deleteManualCommunication,
    getCommunicationCapabilities,
    placeCall,
    sendClientSms,
    sendClientEmail,
    type CommunicationCapabilities,
} from "@/app/actions/communications";
import {
    formatDuration,
    formatPhone,
    statusLabel,
    isUnreached,
    type CommunicationRow,
    type CommunicationChannel,
} from "@/lib/communications";

interface CommunicationsTimelineProps {
    client_id: string;
    client_name: string;
    client_phone?: string | null;
    client_email?: string | null;
    /** Tags newly logged contact with the business tab the rep is looking at. */
    business_profile_id?: string | null;
    /** Lets the parent refresh its activity-age badge after a log. */
    on_logged?: () => void;
}

type ChannelFilter = "all" | CommunicationChannel;

const CHANNEL_FILTERS: { key: ChannelFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "call", label: "Calls" },
    { key: "sms", label: "Texts" },
    { key: "email", label: "Emails" },
];

export function CommunicationsTimeline({
    client_id,
    client_name,
    client_phone,
    client_email,
    business_profile_id,
    on_logged,
}: CommunicationsTimelineProps) {
    const [entries, set_entries] = useState<CommunicationRow[]>([]);
    const [is_loading, set_is_loading] = useState(true);
    const [channel_filter, set_channel_filter] = useState<ChannelFilter>("all");
    const [hide_automated, set_hide_automated] = useState(false);
    const [is_form_open, set_is_form_open] = useState(false);
    const [form_channel, set_form_channel] = useState<CommunicationChannel>("call");
    const [deleting_id, set_deleting_id] = useState<string | null>(null);

    // Which composer is open, if any. Only one at a time — a rep writing a text
    // and an email to the same client simultaneously is a mistake, not a feature.
    const [composer, set_composer] = useState<null | { kind: "sms" | "email"; reply_to?: CommunicationRow }>(null);
    const [capabilities, set_capabilities] = useState<CommunicationCapabilities | null>(null);
    const [caller_id, set_caller_id] = useState<string>("");
    const [is_dialing, set_is_dialing] = useState(false);

    const load = useCallback(async () => {
        const res = await listCommunications(client_id);
        if (!res.success) {
            toast.error("Couldn't load communication history", { description: res.error });
        }
        set_entries(res.communications);
        set_is_loading(false);
    }, [client_id]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        void getCommunicationCapabilities().then((caps) => {
            set_capabilities(caps);
            if (caps.numbers.length > 0) set_caller_id((prev) => prev || caps.numbers[0]);
        });
    }, []);

    const prepend = useCallback(
        (row: CommunicationRow) => {
            set_entries((prev) => [row, ...prev]);
            on_logged?.();
        },
        [on_logged],
    );

    /**
     * Click-to-call: Telzio rings THIS rep's phone first, then bridges the
     * client. The button therefore returns immediately — the rep's handset is
     * what rings, not the browser.
     */
    const handle_call = async () => {
        set_is_dialing(true);
        const res = await placeCall({
            clientId: client_id,
            fromNumber: caller_id || null,
            businessProfileId: business_profile_id ?? null,
        });
        set_is_dialing(false);

        if (!res.success || !res.communication) {
            toast.error("Couldn't place the call", { description: res.error });
            return;
        }
        prepend(res.communication);
        toast.success("Calling you now — pick up and we'll connect the client");
    };

    const visible = useMemo(() => {
        return entries.filter((e) => {
            if (channel_filter !== "all" && e.channel !== channel_filter) return false;
            if (hide_automated && e.is_automated) return false;
            return true;
        });
    }, [entries, channel_filter, hide_automated]);

    // Header stat: only human contact counts. 40 automated doc reminders don't
    // mean anyone has spoken to this client.
    const human_count = useMemo(
        () => entries.filter((e) => !e.is_automated).length,
        [entries],
    );

    const open_log_form = (channel: CommunicationChannel) => {
        set_form_channel(channel);
        set_is_form_open(true);
    };

    const handle_delete = async (id: string) => {
        set_deleting_id(id);
        const res = await deleteManualCommunication(client_id, id);
        set_deleting_id(null);
        if (!res.success) {
            toast.error("Couldn't remove entry", { description: res.error });
            return;
        }
        set_entries((prev) => prev.filter((e) => e.id !== id));
        toast.success("Entry removed");
    };

    return (
        <div className="p-6">
            {/* ── Toolbar ─────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2 mb-5">
                <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                    {CHANNEL_FILTERS.map((f) => (
                        <button
                            key={f.key}
                            type="button"
                            onClick={() => set_channel_filter(f.key)}
                            className={clsx(
                                "px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-colors",
                                channel_filter === f.key
                                    ? "bg-white text-slate-900 shadow-sm"
                                    : "text-slate-500 hover:text-slate-700",
                            )}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                <button
                    type="button"
                    onClick={() => set_hide_automated((v) => !v)}
                    className={clsx(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest border transition-colors",
                        hide_automated
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 text-slate-500 hover:text-slate-700",
                    )}
                    title="Hide reminder emails and other system-generated messages"
                >
                    <Bot className="h-3 w-3" />
                    People only
                </button>

                <div className="ml-auto flex items-center gap-2">
                    {/* Caller ID switcher. Only worth showing when the account
                        actually has more than one number to choose between. */}
                    {capabilities && capabilities.numbers.length > 1 && (
                        <select
                            value={caller_id}
                            onChange={(e) => set_caller_id(e.target.value)}
                            title="Number the client will see"
                            className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-bold text-slate-600 outline-none focus:border-emerald-500"
                        >
                            {capabilities.numbers.map((n) => (
                                <option key={n} value={n}>
                                    {formatPhone(n)}
                                </option>
                            ))}
                        </select>
                    )}

                    {client_phone && (
                        <>
                            {capabilities?.calling ? (
                                <button
                                    type="button"
                                    onClick={handle_call}
                                    disabled={is_dialing || !capabilities.repPhoneOnFile}
                                    title={
                                        capabilities.repPhoneOnFile
                                            ? `Ring your phone, then connect ${formatPhone(client_phone)}`
                                            : "Add your own phone number to your advisor profile to place calls"
                                    }
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-[11px] font-black uppercase tracking-widest transition-colors disabled:opacity-50"
                                >
                                    {is_dialing ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <Phone className="h-3.5 w-3.5" />
                                    )}
                                    Call
                                </button>
                            ) : (
                                // No Telzio yet — hand off to the rep's own handset
                                // and open the log form so the record still happens.
                                <a
                                    href={`tel:${client_phone}`}
                                    onClick={() => open_log_form("call")}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-[11px] font-black uppercase tracking-widest transition-colors"
                                    title={`Call ${formatPhone(client_phone)}`}
                                >
                                    <Phone className="h-3.5 w-3.5" />
                                    Call
                                </a>
                            )}

                            {capabilities?.texting ? (
                                <button
                                    type="button"
                                    onClick={() => set_composer({ kind: "sms" })}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-[11px] font-black uppercase tracking-widest transition-colors"
                                    title={`Text ${formatPhone(client_phone)}`}
                                >
                                    <MessageSquare className="h-3.5 w-3.5" />
                                    Text
                                </button>
                            ) : (
                                <a
                                    href={`sms:${client_phone}`}
                                    onClick={() => open_log_form("sms")}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-[11px] font-black uppercase tracking-widest transition-colors"
                                    title={`Text ${formatPhone(client_phone)}`}
                                >
                                    <MessageSquare className="h-3.5 w-3.5" />
                                    Text
                                </a>
                            )}
                        </>
                    )}

                    {client_email && (
                        capabilities?.email ? (
                            <button
                                type="button"
                                onClick={() => set_composer({ kind: "email" })}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-[11px] font-black uppercase tracking-widest transition-colors"
                                title={`Email ${client_email}`}
                            >
                                <Mail className="h-3.5 w-3.5" />
                                Email
                            </button>
                        ) : (
                            <a
                                href={`mailto:${client_email}`}
                                onClick={() => open_log_form("email")}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-[11px] font-black uppercase tracking-widest transition-colors"
                                title={`Email ${client_email}`}
                            >
                                <Mail className="h-3.5 w-3.5" />
                                Email
                            </a>
                        )
                    )}

                    <button
                        type="button"
                        onClick={() => open_log_form(form_channel)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-black uppercase tracking-widest transition-colors shadow-lg shadow-emerald-700/20"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Log contact
                    </button>
                </div>
            </div>

            {composer?.kind === "sms" && (
                <SmsComposer
                    client_id={client_id}
                    client_phone={client_phone ?? ""}
                    from_number={caller_id || null}
                    business_profile_id={business_profile_id ?? null}
                    on_cancel={() => set_composer(null)}
                    on_sent={(row) => {
                        prepend(row);
                        set_composer(null);
                    }}
                />
            )}

            {composer?.kind === "email" && (
                <EmailComposer
                    client_id={client_id}
                    client_email={client_email ?? ""}
                    reply_to={composer.reply_to}
                    business_profile_id={business_profile_id ?? null}
                    on_cancel={() => set_composer(null)}
                    on_sent={(row) => {
                        prepend(row);
                        set_composer(null);
                    }}
                />
            )}

            {is_form_open && (
                <LogContactForm
                    client_id={client_id}
                    client_name={client_name}
                    initial_channel={form_channel}
                    business_profile_id={business_profile_id ?? null}
                    on_cancel={() => set_is_form_open(false)}
                    on_logged={(row) => {
                        set_entries((prev) => [row, ...prev]);
                        set_is_form_open(false);
                        on_logged?.();
                    }}
                />
            )}

            {/* ── Feed ────────────────────────────────────────────────── */}
            {is_loading ? (
                <div className="flex items-center justify-center py-12 text-slate-400">
                    <Loader2 className="h-5 w-5 animate-spin" />
                </div>
            ) : visible.length === 0 ? (
                <EmptyState
                    filtered={entries.length > 0}
                    client_name={client_name}
                />
            ) : (
                <ol className="space-y-1">
                    {visible.map((entry) => (
                        <TimelineEntry
                            key={entry.id}
                            entry={entry}
                            is_deleting={deleting_id === entry.id}
                            on_delete={() => handle_delete(entry.id)}
                            on_reply={
                                capabilities?.email
                                    ? () => set_composer({ kind: "email", reply_to: entry })
                                    : undefined
                            }
                        />
                    ))}
                </ol>
            )}

            {human_count > 0 && !is_loading && (
                <p className="mt-4 text-[11px] font-bold text-slate-400">
                    {human_count} human touch{human_count === 1 ? "" : "es"}
                    {entries.length !== human_count &&
                        ` · ${entries.length - human_count} automated`}
                </p>
            )}
        </div>
    );
}

// ── Feed entry ───────────────────────────────────────────────────────────────

function TimelineEntry({
    entry,
    is_deleting,
    on_delete,
    on_reply,
}: {
    entry: CommunicationRow;
    is_deleting: boolean;
    on_delete: () => void;
    /** Present only when email sending is available. */
    on_reply?: () => void;
}) {
    const unreached = isUnreached(entry.status);
    const Icon = icon_for(entry);

    return (
        <li className="group flex gap-3 rounded-xl px-3 py-3 hover:bg-slate-50 transition-colors">
            <div
                className={clsx(
                    "mt-0.5 h-8 w-8 shrink-0 rounded-full flex items-center justify-center",
                    unreached
                        ? "bg-slate-100 text-slate-400"
                        : entry.direction === "inbound"
                            ? "bg-sky-100 text-sky-700"
                            : "bg-emerald-100 text-emerald-700",
                )}
            >
                <Icon className="h-4 w-4" />
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-extrabold text-slate-900">
                        {entry.direction === "inbound" ? "Inbound" : "Outbound"}{" "}
                        {entry.channel === "sms" ? "text" : entry.channel}
                    </span>
                    <span
                        className={clsx(
                            "text-[10px] font-black uppercase tracking-widest",
                            unreached ? "text-slate-400" : "text-emerald-700",
                        )}
                    >
                        {statusLabel(entry.status)}
                    </span>
                    {entry.channel === "call" &&
                        entry.duration_seconds != null &&
                        entry.duration_seconds > 0 && (
                            <span className="text-[10px] font-bold text-slate-400">
                                {formatDuration(entry.duration_seconds)}
                            </span>
                        )}
                    {entry.is_automated && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                            <Bot className="h-3 w-3" />
                            Automated
                        </span>
                    )}
                </div>

                {entry.subject && (
                    <p className="mt-0.5 text-sm font-bold text-slate-700 truncate">
                        {entry.subject}
                    </p>
                )}

                {entry.body && (
                    <p className="mt-1 text-sm text-slate-600 whitespace-pre-wrap break-words">
                        {entry.body}
                    </p>
                )}

                <p className="mt-1.5 text-[11px] font-bold text-slate-400">
                    {format(new Date(entry.occurred_at), "MMM d, yyyy · h:mm a")}
                    {entry.staff_name && ` · ${entry.staff_name}`}
                    {contact_endpoint(entry) && ` · ${contact_endpoint(entry)}`}
                </p>

                {entry.error_message && (
                    <p className="mt-1 text-[11px] font-bold text-rose-600">
                        {entry.error_message}
                    </p>
                )}

                <div className="flex items-center gap-3">
                    {entry.recording_url && (
                        <a
                            href={entry.recording_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 inline-block text-[11px] font-black uppercase tracking-widest text-emerald-700 hover:text-emerald-800"
                        >
                            Listen to recording
                        </a>
                    )}

                    {/* Replying threads onto this message, so the client's mail
                        app keeps the conversation together. */}
                    {on_reply && entry.channel === "email" && (
                        <button
                            type="button"
                            onClick={on_reply}
                            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-emerald-700 hover:text-emerald-800"
                        >
                            <Reply className="h-3 w-3" />
                            Reply
                        </button>
                    )}
                </div>
            </div>

            {/* Only manual rows are removable — provider rows are the system's
                record of what actually happened on the wire. */}
            {entry.provider === "manual" && (
                <button
                    type="button"
                    onClick={on_delete}
                    disabled={is_deleting}
                    title="Remove this logged entry"
                    className="self-start opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1.5 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                    {is_deleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                    )}
                </button>
            )}
        </li>
    );
}

function icon_for(entry: CommunicationRow) {
    if (entry.channel === "email") return Mail;
    if (entry.channel === "sms") return MessageSquare;
    if (isUnreached(entry.status)) return PhoneMissed;
    return entry.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
}

/** The client-side endpoint of the conversation, formatted for display. */
function contact_endpoint(entry: CommunicationRow): string {
    const raw = entry.direction === "inbound" ? entry.from_address : entry.to_address;
    if (!raw) return "";
    return entry.channel === "email" ? raw : formatPhone(raw);
}

function EmptyState({ filtered, client_name }: { filtered: boolean; client_name: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 h-12 w-12 rounded-2xl bg-slate-100 flex items-center justify-center">
                <Phone className="h-6 w-6 text-slate-300" />
            </div>
            <p className="text-sm font-semibold text-slate-400">
                {filtered ? "Nothing matches this filter" : "No contact logged yet"}
            </p>
            <p className="mt-1 text-xs text-slate-400">
                {filtered
                    ? "Try a different channel, or turn off “People only”."
                    : `Calls, texts and emails with ${client_name} will appear here.`}
            </p>
        </div>
    );
}

// ── Log form ─────────────────────────────────────────────────────────────────

/** `datetime-local` wants local wall-clock, not the UTC that toISOString gives. */
function to_local_input_value(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function LogContactForm({
    client_id,
    client_name,
    initial_channel,
    business_profile_id,
    on_cancel,
    on_logged,
}: {
    client_id: string;
    client_name: string;
    initial_channel: CommunicationChannel;
    business_profile_id: string | null;
    on_cancel: () => void;
    on_logged: (row: CommunicationRow) => void;
}) {
    const [channel, set_channel] = useState<CommunicationChannel>(initial_channel);
    const [direction, set_direction] = useState<"outbound" | "inbound">("outbound");
    const [connected, set_connected] = useState(true);
    const [minutes, set_minutes] = useState("");
    const [notes, set_notes] = useState("");
    const [occurred_at, set_occurred_at] = useState(() => to_local_input_value(new Date()));
    const [is_saving, set_is_saving] = useState(false);

    // Reopening the form from a different channel button retargets it.
    useEffect(() => {
        set_channel(initial_channel);
    }, [initial_channel]);

    const submit = async () => {
        set_is_saving(true);

        const parsed_minutes = parseFloat(minutes);
        const duration =
            channel === "call" && connected && Number.isFinite(parsed_minutes) && parsed_minutes > 0
                ? Math.round(parsed_minutes * 60)
                : null;

        const when = new Date(occurred_at);
        const res = await logManualContact({
            clientId: client_id,
            channel,
            direction,
            // Only calls can go unanswered; a sent text or email reached its
            // destination as far as the rep knows.
            connected: channel === "call" ? connected : true,
            notes,
            durationSeconds: duration,
            businessProfileId: business_profile_id,
            occurredAt: Number.isNaN(when.getTime()) ? null : when.toISOString(),
        });

        set_is_saving(false);

        if (!res.success || !res.communication) {
            toast.error("Couldn't log this contact", { description: res.error });
            return;
        }

        toast.success("Contact logged");
        on_logged(res.communication);
    };

    return (
        <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                    Log contact with {client_name}
                </p>
                <button
                    type="button"
                    onClick={on_cancel}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
                    aria-label="Cancel"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
                <SegmentedControl
                    value={channel}
                    on_change={(v) => set_channel(v as CommunicationChannel)}
                    options={[
                        { value: "call", label: "Call" },
                        { value: "sms", label: "Text" },
                        { value: "email", label: "Email" },
                    ]}
                />
                <SegmentedControl
                    value={direction}
                    on_change={(v) => set_direction(v as "outbound" | "inbound")}
                    options={[
                        { value: "outbound", label: "We reached out" },
                        { value: "inbound", label: "They reached us" },
                    ]}
                />
                {channel === "call" && (
                    <SegmentedControl
                        value={connected ? "connected" : "missed"}
                        on_change={(v) => set_connected(v === "connected")}
                        options={[
                            { value: "connected", label: "Connected" },
                            { value: "missed", label: "No answer" },
                        ]}
                    />
                )}
            </div>

            <textarea
                value={notes}
                onChange={(e) => set_notes(e.target.value)}
                rows={3}
                placeholder="What was discussed? What's the next step?"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:border-emerald-500 resize-none"
            />

            <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        When
                    </span>
                    <input
                        type="datetime-local"
                        value={occurred_at}
                        onChange={(e) => set_occurred_at(e.target.value)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500"
                    />
                </label>

                {channel === "call" && connected && (
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            Minutes
                        </span>
                        <input
                            type="number"
                            min="0"
                            step="1"
                            value={minutes}
                            onChange={(e) => set_minutes(e.target.value)}
                            placeholder="—"
                            className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500"
                        />
                    </label>
                )}

                <button
                    type="button"
                    onClick={submit}
                    disabled={is_saving}
                    className="ml-auto flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-black uppercase tracking-widest transition-colors disabled:opacity-50 shadow-lg shadow-emerald-700/20"
                >
                    {is_saving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <Plus className="h-3.5 w-3.5" />
                    )}
                    {is_saving ? "Saving…" : "Save to history"}
                </button>
            </div>
        </div>
    );
}

// ── Composers ────────────────────────────────────────────────────────────────

/** Standard SMS segment size; past this the carrier splits the message. */
const SMS_SEGMENT_LENGTH = 160;

function SmsComposer({
    client_id,
    client_phone,
    from_number,
    business_profile_id,
    on_cancel,
    on_sent,
}: {
    client_id: string;
    client_phone: string;
    from_number: string | null;
    business_profile_id: string | null;
    on_cancel: () => void;
    on_sent: (row: CommunicationRow) => void;
}) {
    const [message, set_message] = useState("");
    const [is_sending, set_is_sending] = useState(false);

    const segments = Math.max(1, Math.ceil(message.length / SMS_SEGMENT_LENGTH));

    const send = async () => {
        set_is_sending(true);
        const res = await sendClientSms({
            clientId: client_id,
            message,
            fromNumber: from_number,
            businessProfileId: business_profile_id,
        });
        set_is_sending(false);

        if (!res.success || !res.communication) {
            toast.error("Couldn't send the text", { description: res.error });
            return;
        }
        toast.success("Text sent");
        on_sent(res.communication);
    };

    return (
        <ComposerShell
            title={`Text ${formatPhone(client_phone)}`}
            on_cancel={on_cancel}
            footer={
                <>
                    <span className="text-[11px] font-bold text-slate-400">
                        {message.length} characters
                        {segments > 1 && ` · ${segments} segments`}
                    </span>
                    <button
                        type="button"
                        onClick={send}
                        disabled={is_sending || !message.trim()}
                        className="ml-auto flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-black uppercase tracking-widest transition-colors disabled:opacity-50 shadow-lg shadow-emerald-700/20"
                    >
                        {is_sending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <MessageSquare className="h-3.5 w-3.5" />
                        )}
                        {is_sending ? "Sending…" : "Send text"}
                    </button>
                </>
            }
        >
            <textarea
                value={message}
                onChange={(e) => set_message(e.target.value)}
                rows={3}
                autoFocus
                placeholder="Type your text…"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:border-emerald-500 resize-none"
            />
        </ComposerShell>
    );
}

function EmailComposer({
    client_id,
    client_email,
    reply_to,
    business_profile_id,
    on_cancel,
    on_sent,
}: {
    client_id: string;
    client_email: string;
    /** When present, the message being replied to — threads the response. */
    reply_to?: CommunicationRow;
    business_profile_id: string | null;
    on_cancel: () => void;
    on_sent: (row: CommunicationRow) => void;
}) {
    // Replies inherit the subject with a single "Re:" — stacking them the way
    // some clients do makes long threads unreadable on the timeline.
    const [subject, set_subject] = useState(() => {
        if (!reply_to?.subject) return "";
        return /^re:/i.test(reply_to.subject) ? reply_to.subject : `Re: ${reply_to.subject}`;
    });
    const [body, set_body] = useState("");
    const [is_sending, set_is_sending] = useState(false);

    const send = async () => {
        set_is_sending(true);
        const res = await sendClientEmail({
            clientId: client_id,
            subject,
            body,
            replyToCommunicationId: reply_to?.id ?? null,
            businessProfileId: business_profile_id,
        });
        set_is_sending(false);

        if (!res.success || !res.communication) {
            toast.error("Couldn't send the email", { description: res.error });
            return;
        }
        toast.success("Email sent");
        on_sent(res.communication);
    };

    return (
        <ComposerShell
            title={`${reply_to ? "Reply to" : "Email"} ${client_email}`}
            on_cancel={on_cancel}
            footer={
                <>
                    <span className="text-[11px] font-bold text-slate-400">
                        Replies come back into this timeline
                    </span>
                    <button
                        type="button"
                        onClick={send}
                        disabled={is_sending || !subject.trim() || !body.trim()}
                        className="ml-auto flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-black uppercase tracking-widest transition-colors disabled:opacity-50 shadow-lg shadow-emerald-700/20"
                    >
                        {is_sending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Mail className="h-3.5 w-3.5" />
                        )}
                        {is_sending ? "Sending…" : "Send email"}
                    </button>
                </>
            }
        >
            <input
                value={subject}
                onChange={(e) => set_subject(e.target.value)}
                placeholder="Subject"
                autoFocus={!reply_to}
                className="w-full mb-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 placeholder:text-slate-400 placeholder:font-normal outline-none focus:border-emerald-500"
            />
            <textarea
                value={body}
                onChange={(e) => set_body(e.target.value)}
                rows={6}
                autoFocus={!!reply_to}
                placeholder="Write your message…"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:border-emerald-500 resize-none"
            />
        </ComposerShell>
    );
}

function ComposerShell({
    title,
    on_cancel,
    children,
    footer,
}: {
    title: string;
    on_cancel: () => void;
    children: React.ReactNode;
    footer: React.ReactNode;
}) {
    return (
        <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-500 truncate">
                    {title}
                </p>
                <button
                    type="button"
                    onClick={on_cancel}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors shrink-0"
                    aria-label="Cancel"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
            {children}
            <div className="mt-3 flex flex-wrap items-center gap-3">{footer}</div>
        </div>
    );
}

function SegmentedControl({
    value,
    on_change,
    options,
}: {
    value: string;
    on_change: (value: string) => void;
    options: { value: string; label: string }[];
}) {
    return (
        <div className="flex items-center gap-1 rounded-xl bg-white border border-slate-200 p-1">
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    onClick={() => on_change(o.value)}
                    className={clsx(
                        "px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-colors",
                        value === o.value
                            ? "bg-emerald-700 text-white"
                            : "text-slate-500 hover:text-slate-700",
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}
