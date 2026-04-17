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
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 md:p-3 shadow-sm hover:shadow-2xl hover:scale-[1.03] hover:border-emerald-500/30 transition-all duration-300 cursor-grab active:cursor-grabbing group select-none relative overflow-hidden"
    >
      <div className="flex justify-between items-start mb-1 md:mb-2">
        <h4 className="font-headline font-black text-slate-900 dark:text-slate-100 text-[13px] md:text-sm group-hover:text-emerald-600 transition-colors truncate pr-2">
          {deal.client_name}
        </h4>
        <Link 
          href={`/advisor/dashboard/clients/${deal.id}`} 
          className="text-slate-300 hover:text-emerald-500 transition-colors flex-shrink-0 bg-slate-50 dark:bg-slate-800 p-0.5 md:p-0.5 rounded-lg"
        >
          <ChevronRight className="h-3.5 w-3.5 md:h-4 md:w-4" />
        </Link>
      </div>

      <div className="space-y-1 md:space-y-1.5 mb-3 md:mb-4">
        <div className="flex items-center gap-1.5 md:gap-2 text-slate-500 dark:text-slate-400">
          <div className="bg-slate-100 dark:bg-slate-800 p-1 md:p-1 rounded-lg flex-shrink-0">
            <Building2 className="h-3 md:h-3.5 w-3 md:w-3.5" />
          </div>
          <p className="text-[10px] md:text-xs font-bold truncate">
            {deal.company_name}
          </p>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          <div className="bg-emerald-50 dark:bg-emerald-900/20 p-1 md:p-1.5 rounded-lg flex-shrink-0">
            <DollarSign className="h-3 md:h-3.5 w-3 md:w-3.5 text-emerald-500" />
          </div>
          <p className="text-xs md:text-sm font-black text-slate-900 dark:text-slate-100">
            {new Intl.NumberFormat("en-US", { 
              style: "currency", 
              currency: "USD", 
              maximumFractionDigits: 0 
            }).format(deal.capital_requested)}
          </p>
        </div>
      </div>

      {/* Doc Progress */}
      <div className="space-y-1.5 md:space-y-2 mb-3 md:mb-4 bg-slate-50/50 dark:bg-slate-800/20 p-2 md:p-2 rounded-xl border border-slate-100 dark:border-slate-800">
        <div className="flex justify-between text-[9px] md:text-[10px] uppercase tracking-widest font-black text-slate-400">
          <span>Documents</span>
          <span className="text-emerald-500">{deal.document_count} / {deal.total_required_docs}</span>
        </div>
        <div className="w-full bg-slate-200 dark:bg-slate-700 h-1 md:h-1.5 rounded-full overflow-hidden">
          <div 
            className="h-full bg-emerald-500 transition-all duration-1000 ease-out shadow-[0_0_8px_rgba(16,185,129,0.5)]" 
            style={{ width: `${docsProgress}%` }}
          />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex items-center gap-1.5 md:gap-2 pt-2 md:pt-3 border-t border-slate-100 dark:border-slate-800/50" onClick={(e) => e.stopPropagation()}>
        <a 
          href={`mailto:${deal.client_email}`} 
          className="flex-1 h-7 md:h-8 rounded-xl bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-all border border-transparent hover:border-emerald-200 dark:hover:border-emerald-800"
          title="Email"
        >
          <Mail className="h-3 md:h-3.5 w-3 md:w-3.5" />
        </a>
        <a 
          href={`tel:${deal.client_phone}`} 
          className="flex-1 h-7 md:h-8 rounded-xl bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-all border border-transparent hover:border-emerald-200 dark:hover:border-emerald-800"
          title="Call"
        >
          <Phone className="h-3 md:h-3.5 w-3 md:w-3.5" />
        </a>
      </div>
    </div>
  );
}
