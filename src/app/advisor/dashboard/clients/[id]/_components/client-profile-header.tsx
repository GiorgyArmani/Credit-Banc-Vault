"use client";

import { Loader2, Link, Send, Trash2, UserCog, FileSignature } from "lucide-react";
import clsx from "clsx";

interface ClientProfile {
    id: string;
    user_id: string;
    client_name: string;
    client_email: string;
    client_phone: string;
    company_name: string;
    company_city: string;
    company_state: string;
    capital_requested: number;
    legal_entity_type: string;
    business_start_date: string;
    avg_monthly_deposits: number;
    credit_score: string;
    created_at: string;
    data_vault_submitted_at: string | null;
    contract_completed: boolean;
    contract_completed_at: string | null;
}

interface ClientProfileHeaderProps {
    client_profile: ClientProfile;
    completion_percentage: number;
    is_resending: boolean;
    is_generating_magic_link: boolean;
    on_edit: () => void;
    on_delete_vault: () => void;
    on_resend: () => void;
    on_copy_magic_link: () => void;
    on_add_funding_app: () => void;
}

function format_currency(amount: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}

function format_date(iso_string: string): string {
    if (!iso_string) return "—";
    const date = new Date(iso_string);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function get_initials(name: string): string {
    return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

function parse_credit_score(score: string): { min: number; max: number; value: number } | null {
    const rangeMatch = score?.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (rangeMatch) {
        const min = parseInt(rangeMatch[1]);
        const max = parseInt(rangeMatch[2]);
        const value = Math.round((min + max) / 2);
        return { min, max, value };
    }
    const singleMatch = score?.match(/\d+/);
    if (singleMatch) {
        const value = parseInt(singleMatch[0]);
        return { min: value - 50, max: value + 50, value };
    }
    return null;
}

export function ClientProfileHeader({
    client_profile,
    completion_percentage,
    is_resending,
    is_generating_magic_link,
    on_edit,
    on_delete_vault,
    on_resend,
    on_copy_magic_link,
    on_add_funding_app,
}: ClientProfileHeaderProps) {
    const initials = get_initials(client_profile.client_name);
    const credit = parse_credit_score(client_profile.credit_score);
    const credit_pct = credit
        ? Math.round(((credit.value - 300) / (850 - 300)) * 100)
        : 0;

    const completion_color =
        completion_percentage >= 100
            ? "bg-emerald-100 text-emerald-800"
            : completion_percentage >= 50
            ? "bg-amber-100 text-amber-800"
            : "bg-red-100 text-red-800";

    return (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 mb-8 relative overflow-hidden">
            {/* Gradient accent */}
            <div className="absolute top-0 right-0 w-1/3 h-full bg-gradient-to-l from-emerald-50/80 to-transparent pointer-events-none" />

            <div className="p-8 relative z-10">
                {/* Top row: avatar + name + actions */}
                <div className="flex flex-col md:flex-row justify-between items-start gap-6">
                    {/* Left: Avatar + name */}
                    <div className="flex gap-5 items-center">
                        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-900 to-emerald-700 flex items-center justify-center text-white text-2xl font-black tracking-tight shadow-lg flex-shrink-0">
                            {initials}
                        </div>
                        <div>
                            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                                {client_profile.client_name}
                            </h2>
                            <p className="text-slate-500 text-sm mt-0.5">{client_profile.company_name}</p>
                            <div className="flex items-center gap-2.5 mt-2.5">
                                <span className={clsx("px-3 py-1 rounded-full text-[11px] font-bold", completion_color)}>
                                    {completion_percentage}% Complete
                                </span>
                                <span className="text-slate-400 text-xs font-medium flex items-center gap-1">
                                    <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    Priority Client
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Right: 2×2 action grid */}
                    <div className="grid grid-cols-2 gap-2 w-full md:w-auto md:min-w-[280px] flex-shrink-0">
                        <button
                            onClick={on_edit}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition-colors"
                        >
                            <UserCog className="h-4 w-4" />
                            Edit Profile
                        </button>
                        <button
                            onClick={on_copy_magic_link}
                            disabled={is_generating_magic_link}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
                        >
                            {is_generating_magic_link ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Link className="h-4 w-4" />
                            )}
                            {is_generating_magic_link ? "Generating…" : "Copy Magic Link"}
                        </button>
                        <button
                            onClick={on_resend}
                            disabled={is_resending}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
                        >
                            {is_resending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Send className="h-4 w-4" />
                            )}
                            {is_resending ? "Sending…" : "Resend Login"}
                        </button>
                        {!client_profile.contract_completed ? (
                            <button
                                onClick={on_add_funding_app}
                                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-sm font-semibold rounded-xl transition-colors"
                            >
                                <FileSignature className="h-4 w-4" />
                                Add Funding App
                            </button>
                        ) : (
                            <button
                                onClick={on_delete_vault}
                                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 text-sm font-semibold rounded-xl transition-colors"
                            >
                                <Trash2 className="h-4 w-4" />
                                Delete Vault
                            </button>
                        )}
                        {!client_profile.contract_completed && (
                            <button
                                onClick={on_delete_vault}
                                className="col-span-2 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 text-sm font-semibold rounded-xl transition-colors"
                            >
                                <Trash2 className="h-4 w-4" />
                                Delete Vault
                            </button>
                        )}
                    </div>
                </div>

                {/* Divider + 4-column info strip */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mt-8 pt-8 border-t border-slate-100">
                    {/* Contact */}
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Contact</p>
                        <a
                            href={`mailto:${client_profile.client_email}`}
                            className="text-sm font-semibold text-slate-800 hover:text-emerald-700 transition-colors block truncate"
                        >
                            {client_profile.client_email}
                        </a>
                        <a
                            href={`tel:${client_profile.client_phone}`}
                            className="text-sm text-slate-500 hover:text-emerald-700 transition-colors block mt-0.5"
                        >
                            {client_profile.client_phone}
                        </a>
                        <p className="text-[11px] text-slate-400 mt-2">
                            Created: {format_date(client_profile.created_at)}
                        </p>
                    </div>

                    {/* Business */}
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Business</p>
                        <p className="text-sm font-semibold text-slate-800">{client_profile.legal_entity_type}</p>
                        <p className="text-sm text-slate-500 mt-0.5">
                            {client_profile.company_city}, {client_profile.company_state}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-2">
                            Started: {format_date(client_profile.business_start_date)}
                        </p>
                    </div>

                    {/* Financials */}
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Financials</p>
                        <div className="flex items-baseline gap-2">
                            <p className="text-lg font-black text-emerald-700">
                                {format_currency(client_profile.capital_requested)}
                            </p>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Requested</span>
                        </div>
                        <p className="text-sm text-slate-500 mt-0.5">
                            Rev: {format_currency(client_profile.avg_monthly_deposits)} / mo
                        </p>
                    </div>

                    {/* Credit Score */}
                    <div className="bg-slate-50 p-4 rounded-2xl">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Credit Score</p>
                        {credit ? (
                            <>
                                <div className="flex items-center gap-3 mb-2">
                                    <span
                                        className={clsx(
                                            "text-2xl font-black",
                                            credit.value >= 720 ? "text-emerald-600" : credit.value >= 660 ? "text-amber-600" : "text-red-600"
                                        )}
                                    >
                                        {credit.value}
                                    </span>
                                    <div className="h-1.5 flex-1 bg-slate-200 rounded-full overflow-hidden">
                                        <div
                                            className={clsx(
                                                "h-full rounded-full transition-all duration-700",
                                                credit.value >= 720 ? "bg-emerald-500" : credit.value >= 660 ? "bg-amber-400" : "bg-red-500"
                                            )}
                                            style={{ width: `${credit_pct}%` }}
                                        />
                                    </div>
                                </div>
                                <p className="text-[10px] text-slate-400 italic">
                                    Range: {credit.min}–{credit.max}
                                </p>
                            </>
                        ) : (
                            <p className="text-sm font-semibold text-slate-700">{client_profile.credit_score || "—"}</p>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}
