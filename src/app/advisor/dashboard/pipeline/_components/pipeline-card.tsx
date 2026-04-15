"use client";

import { Building2, DollarSign, Mail, Phone, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

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
  };
  onDragStart: (e: React.DragEvent, id: string) => void;
}

export function PipelineDealCard({ deal, onDragStart }: PipelineCardProps) {
  const docsProgress = deal.total_required_docs > 0 
    ? (deal.document_count / deal.total_required_docs) * 100 
    : 0;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, deal.id)}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing group select-none"
    >
      <div className="flex justify-between items-start mb-1.5">
        <h4 className="font-bold text-slate-900 dark:text-slate-100 text-[11px] group-hover:text-emerald-600 transition-colors truncate pr-2">
          {deal.client_name}
        </h4>
        <Link 
          href={`/advisor/dashboard/clients/${deal.id}`} 
          className="text-slate-300 hover:text-emerald-500 transition-colors flex-shrink-0"
        >
          <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="space-y-1 mb-3">
        <p className="text-[9px] text-slate-400 flex items-center gap-1 truncate">
          <Building2 className="h-2.5 w-2.5" />
          {deal.company_name}
        </p>
        <p className="text-[10px] font-black text-slate-900 dark:text-slate-100 flex items-center gap-1">
          <DollarSign className="h-2.5 w-2.5 text-emerald-500" />
          {new Intl.NumberFormat("en-US", { 
            style: "currency", 
            currency: "USD", 
            maximumFractionDigits: 0 
          }).format(deal.capital_requested)}
        </p>
      </div>

      {/* Doc Progress */}
      <div className="space-y-1 mb-3">
        <div className="flex justify-between text-[8px] uppercase tracking-wider font-bold text-slate-400">
          <span>Docs</span>
          <span>{deal.document_count}/{deal.total_required_docs}</span>
        </div>
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-1 rounded-full overflow-hidden">
          <div 
            className="h-full bg-emerald-500 transition-all duration-500" 
            style={{ width: `${docsProgress}%` }}
          />
        </div>
      </div>

      {/* Quick Actions - Icons only */}
      <div className="flex items-center gap-1.5 pt-2 border-t border-slate-50 dark:border-slate-800/50" onClick={(e) => e.stopPropagation()}>
        <a 
          href={`mailto:${deal.client_email}`} 
          className="flex-1 h-6 rounded-md bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-all"
          title="Email"
        >
          <Mail className="h-3 w-3" />
        </a>
        <a 
          href={`tel:${deal.client_phone}`} 
          className="flex-1 h-6 rounded-md bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-all"
          title="Call"
        >
          <Phone className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
