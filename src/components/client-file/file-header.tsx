// src/components/client-file/file-header.tsx
"use client";

//  ‹ ← Back to prospects 5/169 ›                      [Request docs] [Share] [Submit to UW] [⋯]
//  Silver Key Lounge ▾                                ▰▰▰▰▰▱▱▱ Matched  ⟲  [→ Docs received]
//  Gregory McCleary · Food & Beverage · LLC
//  ● Urgent · 86d in pipeline · Last touch 19d ago
//
// Replaces ClientCommandBar + ClientProfileHeader on the workspace file. Not
// sticky: with nothing folding the page is short, and a three-line sticky
// header would eat a laptop viewport.

import React, { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Loader2, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LoanStatus, PipelineStatusEntry } from "@/app/actions/pipeline";
import { LoanPipelineFull } from "@/components/loan-pipeline-status";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BusinessTab } from "@/app/advisor/dashboard/clients/[id]/_components/business-tab-strip";
import type { HeaderActionId, MenuItemId } from "./capabilities";
import { BarIconButton, PipelineRail, getNextStep } from "./pipeline-rail";
import { BusinessSwitcher } from "./business-switcher";

export type HeaderAction =
  | {
      id: HeaderActionId;
      label: string;
      icon?: LucideIcon;
      onClick: () => void;
      disabled?: boolean;
      busy?: boolean;
      title?: string;
      tone?: "danger";
    }
  | { id: HeaderActionId; render: (className: string) => React.ReactNode };

export type HeaderMenuItem = {
  id: MenuItemId;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  busy?: boolean;
  destructive?: boolean;
};

export const HEADER_BUTTON = {
  base: "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
  secondary: "border border-black/10 bg-white text-cb-ink hover:bg-cb-cream",
  // Disabled primary reads as an inert grey chip, not a washed-out mint one
  // (opacity-100 overrides base's disabled:opacity-50 through twMerge).
  primary:
    "bg-cb-mint text-cb-navy shadow-sm hover:brightness-95 disabled:bg-black/5 disabled:text-cb-ink/40 disabled:shadow-none disabled:opacity-100",
  danger: "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50",
};

export type FileHeaderProps = {
  back_label: string;
  on_back: () => void;
  on_prev?: () => void;
  on_next?: () => void;
  nav_index?: number;
  nav_total?: number;

  businesses: BusinessTab[];
  active_business_id: string | null;
  fallback_business_name: string;
  on_select_business: (id: string) => void;
  on_add_business?: () => void;
  on_delete_business?: (b: BusinessTab) => void;

  /** Client name, industry, entity: empty values are dropped. */
  identity: (string | null | undefined)[];
  status_line: React.ReactNode;

  current_status: LoanStatus;
  pipeline_history: PipelineStatusEntry[];
  on_status_change?: (status: LoanStatus) => void;
  is_advancing?: boolean;
  advance_limit_index?: number | null;

  actions: HeaderAction[];
  /** Styles the action whose id matches this as primary (danger tone still wins). */
  primary_id?: HeaderActionId;
  menu: HeaderMenuItem[];
};

export function FileHeader(props: FileHeaderProps) {
  const [details_open, set_details_open] = useState(false);
  const next_step = getNextStep(props.current_status, props.advance_limit_index);
  const show_counter = !!props.nav_index && !!props.nav_total && props.nav_index > 0 && props.nav_total > 0;
  const identity = props.identity.filter((part): part is string => !!part && part !== "—");
  const safe_items = props.menu.filter((item) => !item.destructive);
  const destructive_items = props.menu.filter((item) => item.destructive);

  return (
    <TooltipProvider delayDuration={150}>
      <header className="rounded-2xl border border-black/5 bg-white shadow-sm">
        {/* Row 1: queue nav + actions */}
        <div className="flex flex-wrap items-center gap-2 border-b border-black/5 px-2 py-2 sm:px-3">
          <div className="flex shrink-0 items-center gap-0.5">
            <BarIconButton label="Previous client" onClick={props.on_prev} disabled={!props.on_prev}>
              <ChevronLeft className="h-4 w-4" />
            </BarIconButton>
            <button
              type="button"
              onClick={props.on_back}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-cb-ink/70 transition-colors hover:bg-black/5 hover:text-cb-ink"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">{props.back_label}</span>
              {show_counter && (
                <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-emerald-700">
                  {props.nav_index}/{props.nav_total}
                </span>
              )}
            </button>
            <BarIconButton label="Next client" onClick={props.on_next} disabled={!props.on_next}>
              <ChevronRight className="h-4 w-4" />
            </BarIconButton>
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {props.actions.map((action) => {
              const variant =
                "tone" in action && action.tone === "danger"
                  ? HEADER_BUTTON.danger
                  : action.id === props.primary_id
                    ? HEADER_BUTTON.primary
                    : HEADER_BUTTON.secondary;
              const className = cn(HEADER_BUTTON.base, variant);
              if ("render" in action) return <React.Fragment key={action.id}>{action.render(className)}</React.Fragment>;
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.onClick}
                  disabled={action.disabled || action.busy}
                  title={action.title}
                  className={className}
                >
                  {action.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
                  {action.label}
                </button>
              );
            })}

            {props.menu.length > 0 && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="More actions"
                    className={cn(HEADER_BUTTON.base, HEADER_BUTTON.secondary, "w-9 px-0")}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  {safe_items.map((item) => (
                    <HeaderMenuRow key={item.id} item={item} />
                  ))}
                  {safe_items.length > 0 && destructive_items.length > 0 && <DropdownMenuSeparator />}
                  {destructive_items.map((item) => (
                    <HeaderMenuRow key={item.id} item={item} />
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Row 2: identity + pipeline */}
        <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-1">
            <BusinessSwitcher
              businesses={props.businesses}
              active_business_id={props.active_business_id}
              fallback_name={props.fallback_business_name}
              on_select={props.on_select_business}
              on_add={props.on_add_business}
              on_delete={props.on_delete_business}
            />
            {identity.length > 0 && <p className="truncate text-sm text-cb-ink/60">{identity.join(" · ")}</p>}
            {props.status_line}
          </div>

          <div className="flex w-full items-center gap-2 lg:w-[420px] lg:shrink-0">
            <PipelineRail
              current_status={props.current_status}
              pipeline_history={props.pipeline_history}
              on_status_change={props.on_status_change}
              details_open={details_open}
              on_toggle_details={() => set_details_open((v) => !v)}
              label_variant="header"
            />
            {next_step && props.on_status_change && (
              <button
                type="button"
                onClick={() => props.on_status_change?.(next_step.status)}
                disabled={props.is_advancing}
                className={cn(HEADER_BUTTON.base, HEADER_BUTTON.secondary, "h-8 shrink-0 px-2.5 text-xs")}
              >
                {props.is_advancing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <ArrowRight className="h-3.5 w-3.5" />
                    {next_step.shortLabel}
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {details_open && (
          <div className="border-t border-black/5 px-6 py-5">
            <LoanPipelineFull
              currentStatus={props.current_status}
              history={props.pipeline_history}
              onStatusChange={props.on_status_change}
            />
          </div>
        )}
      </header>
    </TooltipProvider>
  );
}

function HeaderMenuRow({ item }: { item: HeaderMenuItem }) {
  const Icon = item.icon;
  return (
    <DropdownMenuItem
      onSelect={item.onSelect}
      disabled={item.disabled || item.busy}
      className={cn("gap-2", item.destructive && "text-rose-600 focus:text-rose-700")}
    >
      {item.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {item.label}
    </DropdownMenuItem>
  );
}
