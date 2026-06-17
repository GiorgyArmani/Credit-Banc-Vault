"use client";

import { Mail, Phone, ChevronRight } from "lucide-react";
import Link from "next/link";
import { ActivityAgeBadge } from "@/components/advisor/activity-age-badge";
import { ReassignmentPauseControl } from "@/app/advisor/dashboard/clients/[id]/_components/reassignment-pause-control";

interface PipelineCardProps {
  deal: {
    id: string;
    client_name: string;
    company_name: string;
    capital_requested: number;
    client_email: string;
    client_phone: string;
    document_count: number;
    total_required_docs: number;
    created_at: string;
    last_activity_at?: string;
    reassigned_to_catch_all_at?: string | null;
    reassignment_paused_until?: string | null;
  };
  detailHref: string;
  onOpen?: () => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
}

const fmt_currency = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

const fmt_phone = (p: string) => {
  const digits = (p || "").replace(/\D/g, "");
  const local = digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
  if (local.length === 10) return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  return p;
};

export function PipelineDealCard({ deal, detailHref, onOpen, onDragStart }: PipelineCardProps) {
  const docsProgress = deal.total_required_docs > 0
    ? Math.min(100, (deal.document_count / deal.total_required_docs) * 100)
    : 0;
  const docsComplete = deal.total_required_docs > 0 && deal.document_count >= deal.total_required_docs;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, deal.id)}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-sm hover:shadow-lg hover:border-emerald-500/40 transition-all duration-200 cursor-grab active:cursor-grabbing group select-none"
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h4 className="font-black text-slate-900 dark:text-slate-100 text-[13px] leading-tight group-hover:text-emerald-600 transition-colors break-words flex-1 min-w-0">
          {deal.client_name}
        </h4>
        <div className="flex items-center gap-1 flex-shrink-0">
          <ReassignmentPauseControl
            clientId={deal.id}
            paused_until={deal.reassignment_paused_until ?? null}
            compact
          />
          <Link
            href={detailHref}
            onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
            className="text-slate-300 hover:text-emerald-500 transition-colors bg-slate-50 dark:bg-slate-800 p-0.5 rounded-lg"
            title="Open deal"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Company */}
      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate mb-1">
        {deal.company_name || "—"}
      </p>

      {/* Phone — shown inline so reps can dial without opening the deal */}
      {deal.client_phone && (
        <a
          href={`tel:${deal.client_phone}`}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 w-fit text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-emerald-600 transition-colors mb-2"
        >
          <Phone className="h-3 w-3 flex-shrink-0" />
          {fmt_phone(deal.client_phone)}
        </a>
      )}

      {/* Currency on its own row — never gets cropped */}
      <div className="text-[15px] font-black text-slate-900 dark:text-slate-100 tabular-nums mb-2">
        {fmt_currency(deal.capital_requested)}
      </div>

      {/* Activity chip — full width to avoid wrapping */}
      <div className="mb-2.5">
        <ActivityAgeBadge
          created_at={deal.created_at}
          last_activity_at={deal.last_activity_at}
          reassigned_to_catch_all_at={deal.reassigned_to_catch_all_at}
          variant="compact"
          className="max-w-full"
        />
      </div>

      {/* Doc progress — minimal */}
      <div className="space-y-1 mb-2.5">
        <div className="flex justify-between items-center text-[9px] uppercase tracking-wider font-black">
          <span className="text-slate-400">Docs</span>
          <span className={docsComplete ? "text-emerald-600" : "text-slate-500"}>
            {deal.document_count}/{deal.total_required_docs}
          </span>
        </div>
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-1 rounded-full overflow-hidden">
          <div
            className={docsComplete ? "h-full bg-emerald-500 transition-all duration-700" : "h-full bg-emerald-400 transition-all duration-700"}
            style={{ width: `${docsProgress}%` }}
          />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800/50" onClick={(e) => e.stopPropagation()}>
        <a
          href={`mailto:${deal.client_email}`}
          className="flex-1 h-7 rounded-lg bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-all"
          title={`Email ${deal.client_email}`}
        >
          <Mail className="h-3.5 w-3.5" />
        </a>
        <a
          href={`tel:${deal.client_phone}`}
          className="flex-1 h-7 rounded-lg bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-all"
          title={`Call ${deal.client_phone}`}
        >
          <Phone className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}
