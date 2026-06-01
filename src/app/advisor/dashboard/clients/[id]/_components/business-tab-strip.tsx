"use client";

import { Plus, Building2, Star, X } from "lucide-react";
import clsx from "clsx";

export interface BusinessTab {
  id: string;
  company_name: string;
  is_primary: boolean;
  // Optional per-business display fields. Populated by the advisor detail page
  // so switching tabs can rescope the profile header without an extra fetch.
  legal_entity_type?: string | null;
  business_start_date?: string | null;
  company_city?: string | null;
  company_state?: string | null;
  company_zip_code?: string | null;
  avg_monthly_deposits?: number | null;
  avg_annual_revenue?: number | null;
  employees_count?: number | null;
  is_home_based?: boolean | null;
  industry?: string | null;
  // Funding ask — sourced from this business's funding_deals row (not
  // business_profiles). Flattened in by the detail page so switching tabs
  // rescopes the funding figures shown in the header / notes.
  capital_requested?: number | null;
  proposed_loan_type?: string | null;
  loan_purpose?: string | null;
  funding_eta?: string | null;
}

interface BusinessTabStripProps {
  businesses: BusinessTab[];
  active_business_id: string | null;
  on_select: (id: string) => void;
  /** When provided, renders an "+ Add Business" CTA at the end of the strip. */
  on_add?: () => void;
  /** When provided, each non-primary tab gets a delete affordance. Advisor/admin only. */
  on_delete?: (b: BusinessTab) => void;
  /** Allow the empty/single-business state to render the strip anyway (for the "+ Add Business" CTA). Defaults to true. */
  show_when_single?: boolean;
}

export function BusinessTabStrip({
  businesses,
  active_business_id,
  on_select,
  on_add,
  on_delete,
  show_when_single = true,
}: BusinessTabStripProps) {
  if (!show_when_single && businesses.length <= 1) return null;
  if (businesses.length === 0 && !on_add) return null;

  return (
    <div className="mb-6 flex items-center gap-2 overflow-x-auto pb-2 -mx-1 px-1">
      {businesses.map((b) => {
        const is_active = b.id === active_business_id;
        const can_delete = !b.is_primary && !!on_delete;
        return (
          <div
            key={b.id}
            className={clsx(
              "group relative flex items-center rounded-xl text-sm font-semibold whitespace-nowrap transition-all border",
              is_active
                ? "bg-emerald-700 text-white border-emerald-700 shadow-sm"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
            )}
          >
            <button
              type="button"
              onClick={() => on_select(b.id)}
              className={clsx(
                "flex items-center gap-2 pl-4 py-2.5",
                can_delete ? "pr-1" : "pr-4"
              )}
            >
              {b.is_primary ? (
                <Star className={clsx("h-3.5 w-3.5", is_active ? "fill-white text-white" : "fill-amber-400 text-amber-400")} />
              ) : (
                <Building2 className="h-3.5 w-3.5" />
              )}
              <span className="truncate max-w-[200px]">{b.company_name}</span>
            </button>
            {can_delete && (
              <button
                type="button"
                title={`Remove ${b.company_name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  on_delete!(b);
                }}
                className={clsx(
                  "ml-1 mr-2 p-1 rounded-md transition-colors",
                  is_active
                    ? "hover:bg-emerald-800 text-white/80 hover:text-white"
                    : "hover:bg-red-100 text-slate-400 hover:text-red-600",
                  // Visible always on the active tab; on hover for inactive tabs.
                  is_active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}

      {on_add && (
        <button
          type="button"
          onClick={on_add}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-emerald-700 border border-dashed border-emerald-300 hover:bg-emerald-50 transition-colors whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          Add Business
        </button>
      )}
    </div>
  );
}
