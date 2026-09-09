// src/app/underwriting/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  Loader2,
  AlertCircle,
  ShieldCheck,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import clsx from "clsx";
import { getBulkLatestStatus, type LoanStatus } from "@/app/actions/pipeline";
import { normalizeSupabaseJoin } from "@/lib/document-scope";
import type { GroupCriteria, GroupableLead, LeadBucket } from "@/lib/lead-groups";
import { resolveGroupMembers } from "@/lib/lead-groups";
import { GroupChipRail, useLeadGroups } from "./_components/group-chip-rail";
import { ReadyCard } from "./_components/ready-card";
import { LeadTable } from "./_components/client-row";
import { daysSince, sortLeads, type SortDir, type SortKey } from "./_components/lead-display";

enum ComponentState {
  LOADING = "LOADING",
  ERROR = "ERROR",
  SUCCESS = "SUCCESS",
}

const BUCKET_META: {
  key: LeadBucket;
  label: string;
  icon: typeof ShieldCheck;
  tile: string;
  value: string;
}[] = [
  { key: "ready", label: "Ready", icon: ShieldCheck, tile: "bg-primary-container/15 border-primary/25", value: "text-primary-fixed" },
  { key: "active", label: "Vaults", icon: Clock, tile: "bg-blue-400/10 border-blue-400/25", value: "text-blue-300" },
  { key: "funded", label: "Funded", icon: CheckCircle2, tile: "bg-violet-400/10 border-violet-400/25", value: "text-violet-300" },
  { key: "declined", label: "Declined", icon: AlertCircle, tile: "bg-rose-400/10 border-rose-400/25", value: "text-rose-300" },
];

export default function UnderwritingDashboardPage() {
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();

  const [component_state, set_component_state] = useState<ComponentState>(ComponentState.LOADING);
  const [leads, set_leads] = useState<GroupableLead[]>([]);
  const [advisors, set_advisors] = useState<{ id: string; name: string }[]>([]);
  const [error_message, set_error_message] = useState<string>("");
  const [search_query, set_search_query] = useState<string>("");

  // Tab and group are mutually exclusive: a group spans all four buckets, so
  // selecting one clears the tab and vice versa. Keeping both active would mean
  // the same chip showing four different counts depending on a tab the user may
  // not be looking at.
  const [active_tab, set_active_tab] = useState<LeadBucket>("ready");
  const [active_group_id, set_active_group_id] = useState<string | null>(null);

  const [sort_key, set_sort_key] = useState<SortKey>("age");
  const [sort_dir, set_sort_dir] = useState<SortDir>("desc");

  const groupState = useLeadGroups(true);

  useEffect(() => {
    void fetch_data();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byBucket = useMemo(() => {
    const map: Record<LeadBucket, GroupableLead[]> = { ready: [], active: [], funded: [], declined: [] };
    for (const lead of leads) map[lead.bucket].push(lead);
    return map;
  }, [leads]);

  const activeGroup = useMemo(
    () => groupState.groups.find(g => g.id === active_group_id) ?? null,
    [groupState.groups, active_group_id]
  );

  /** The rows on screen: group members if a chip is active, else the tab. */
  const visible = useMemo(() => {
    const base = activeGroup
      ? resolveGroupMembers(leads, activeGroup.criteria, activeGroup.members)
      : byBucket[active_tab];

    const q = search_query.trim().toLowerCase();
    const searched = q
      ? base.filter(l =>
          [l.company_name, l.client_name, l.client_email, l.advisor_name]
            .join(" ")
            .toLowerCase()
            .includes(q)
        )
      : base;

    return sortLeads(searched, sort_key, sort_dir);
  }, [activeGroup, leads, byBucket, active_tab, search_query, sort_key, sort_dir]);

  /**
   * `+ New group` opens pre-filled with what the underwriter is already looking
   * at. The moment someone wants to save a filter is the moment they just built
   * one by hand.
   */
  function seedCriteria(): GroupCriteria {
    const seed: GroupCriteria = {};
    if (!activeGroup) seed.buckets = [active_tab];
    const q = search_query.trim();
    if (q) seed.search = q;
    return seed;
  }

  function handleSort(key: SortKey) {
    if (key === sort_key) {
      set_sort_dir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      set_sort_key(key);
      set_sort_dir(key === "company" ? "asc" : "desc");
    }
  }

  const detailBase = pathname.startsWith("/admin")
    ? "/admin/clients/"
    : "/underwriting/dashboard/clients/";
  const hrefFor = (lead: GroupableLead) => detailBase + lead.id;

  async function fetch_data() {
    try {
      set_component_state(ComponentState.LOADING);

      const { data: vault_data, error: vault_error } = await supabase
        .from("client_data_vault")
        .select(
          `
                    id,
                    user_id,
                    client_name,
                    client_email,
                    company_name,
                    company_state,
                    credit_score,
                    capital_requested,
                    created_at,
                    advisor_id,
                    advisors!client_data_vault_advisor_id_fkey (
                        first_name,
                        last_name
                    )
                `
        )
        .order("created_at", { ascending: false });

      if (vault_error) throw vault_error;

      if (!vault_data || vault_data.length === 0) {
        set_leads([]);
        set_component_state(ComponentState.SUCCESS);
        return;
      }

      const { data: sub_data } = await supabase
        .from("submissions")
        .select("user_id, status, submitted_at");
      const submission_map = new Map(sub_data?.map(s => [s.user_id, s]) || []);

      const allVaultIds = vault_data.map(c => c.id);
      const allUserIds = vault_data.map(c => c.user_id);
      const pipelineMap = await getBulkLatestStatus(allVaultIds);

      // Bulk-fetch doc data for every client in one shot, then bucket by
      // user_id in memory. Doing this per-client inside the loop turned the
      // queue load into 2×N sequential round-trips (minutes on real data);
      // collapsing it keeps load under a few seconds regardless of vault size.
      //
      // NOTE: the old `required_documents where is_core = true` query is gone.
      // Document sets are preselected per loan type now — PROGRAM_DOCUMENT_PACKAGES
      // is materialized into client_dynamic_documents at creation, so that table
      // IS the requirement set. is_core is true on zero rows, so the query
      // fetched nothing while leaving a live footgun: setting it on one row
      // would have inflated every client's denominator app-wide.
      const { data: allDynamicDocs } = await supabase
        .from("client_dynamic_documents")
        .select("user_id, required_documents(code)")
        .in("user_id", allUserIds)
        .eq("is_active", true);

      const { data: allUploadedDocs } = await supabase
        .from("user_documents")
        .select("user_id, category, doc_code")
        .in("user_id", allUserIds);

      // Approvals are what "done" means everywhere else in the app — the
      // vault_completed tag keys off advisor approval, not upload. This queue
      // was the one surface calling a document satisfied the moment a file
      // landed, so an 8/8 file could have eight unreviewed documents on it.
      const { data: allApprovals } = await supabase
        .from("document_category_approvals")
        .select("client_vault_id, doc_code")
        .in("client_vault_id", allVaultIds);

      // normalizeSupabaseJoin: SDK returns the embed as object or array.
      // Without it the UW queue dashboard counts zero dynamic docs.
      const dynamicByUser = new Map<string, Set<string>>();
      for (const d of (allDynamicDocs as any[] | null) ?? []) {
        const code = normalizeSupabaseJoin<{ code?: string }>(d.required_documents)?.code;
        if (!code) continue;
        const set = dynamicByUser.get(d.user_id);
        if (set) set.add(code);
        else dynamicByUser.set(d.user_id, new Set([code]));
      }

      const uploadedByUser = new Map<string, Set<string>>();
      for (const u of allUploadedDocs ?? []) {
        let set = uploadedByUser.get(u.user_id);
        if (!set) {
          set = new Set<string>();
          uploadedByUser.set(u.user_id, set);
        }
        if (u.category) set.add(u.category);
        if (u.doc_code) set.add(u.doc_code);
      }

      const approvedByVault = new Map<string, Set<string>>();
      for (const a of allApprovals ?? []) {
        let set = approvedByVault.get(a.client_vault_id);
        if (!set) {
          set = new Set<string>();
          approvedByVault.set(a.client_vault_id, set);
        }
        if (a.doc_code) set.add(a.doc_code);
      }

      const advisorNames = new Map<string, string>();
      const next: GroupableLead[] = [];

      for (const client of vault_data) {
        const sub = submission_map.get(client.user_id);
        const advisor: any = normalizeSupabaseJoin<any>(client.advisors);
        const pStatus = (pipelineMap.get(client.id) ?? "created") as LoanStatus;

        const required = dynamicByUser.get(client.user_id) ?? new Set<string>();
        const uploaded = uploadedByUser.get(client.user_id) ?? new Set<string>();
        const approved = approvedByVault.get(client.id) ?? new Set<string>();

        let docsApproved = 0;
        let docsAwaiting = 0;
        for (const code of required) {
          if (approved.has(code)) docsApproved += 1;
          else if (uploaded.has(code)) docsAwaiting += 1;
        }

        // Routing into buckets. Pipeline status wins; submission lock is the
        // tiebreak that separates "ready for review" from "still filling in".
        const bucket: LeadBucket =
          pStatus === "funded"
            ? "funded"
            : pStatus === "declined"
              ? "declined"
              : sub?.status === "locked"
                ? "ready"
                : "active";

        const advisor_name = advisor
          ? `${advisor.first_name ?? ""} ${advisor.last_name ?? ""}`.trim() || "Unknown Advisor"
          : "Unknown Advisor";
        if (client.advisor_id && advisor) advisorNames.set(client.advisor_id, advisor_name);

        next.push({
          id: client.id,
          bucket,
          pipeline_status: pStatus,
          advisor_id: client.advisor_id ?? null,
          capital_requested: client.capital_requested,
          docs_approved: docsApproved,
          docs_total: required.size,
          docs_awaiting_review: docsAwaiting,
          age_days: daysSince(sub?.submitted_at || client.created_at),
          company_state: client.company_state,
          credit_score: client.credit_score,
          client_name: client.client_name,
          client_email: client.client_email,
          company_name: client.company_name,
          advisor_name,
        });
      }

      set_leads(next);
      set_advisors(
        Array.from(advisorNames, ([id, name]) => ({ id, name })).sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );
      set_component_state(ComponentState.SUCCESS);
    } catch (err: any) {
      console.error("fetch_data error:", err);
      set_error_message(err.message || "Failed to load review data.");
      set_component_state(ComponentState.ERROR);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header band — the one dark surface on this page. */}
      <section className="relative overflow-hidden rounded-2xl border border-white/5 bg-on-secondary-fixed p-8 text-white md:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
        />
        <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl space-y-3">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 text-primary">
                <ShieldCheck className="h-6 w-6" aria-hidden />
              </span>
              <h1 className="font-headline text-3xl font-extrabold leading-[1.02] tracking-tighter md:text-4xl">
                Underwriting Portal
              </h1>
            </div>
            <p className="leading-relaxed text-white/70">
              Track client submissions and active vaults to process funding applications.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {BUCKET_META.map(meta => {
              const Icon = meta.icon;
              return (
                <div
                  key={meta.key}
                  className={clsx(
                    "flex items-center justify-between gap-3 rounded-xl border p-3.5 backdrop-blur-md",
                    meta.tile
                  )}
                >
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">
                      {meta.label}
                    </p>
                    <p className={clsx("mt-1 text-2xl font-extrabold leading-none tabular-nums", meta.value)}>
                      {byBucket[meta.key].length}
                    </p>
                  </div>
                  <Icon className="h-6 w-6 text-white/25" aria-hidden />
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Tabs + search */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          value={active_group_id ? "" : active_tab}
          onValueChange={v => {
            set_active_tab(v as LeadBucket);
            set_active_group_id(null);
          }}
        >
          <TabsList className="h-11 rounded-xl border border-outline-variant/30 bg-white p-1">
            {BUCKET_META.map(meta => {
              const Icon = meta.icon;
              return (
                <TabsTrigger
                  key={meta.key}
                  value={meta.key}
                  className="gap-1.5 rounded-lg px-4 text-xs font-semibold text-on-surface-variant data-[state=active]:bg-on-secondary-fixed data-[state=active]:text-primary-fixed data-[state=active]:shadow-none"
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {meta.label}
                  <span className="tabular-nums opacity-70">{byBucket[meta.key].length}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        <div className="relative w-full lg:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search name, company, advisor..."
            value={search_query}
            onChange={e => set_search_query(e.target.value)}
            className="h-11 rounded-xl border-outline-variant/30 bg-white pl-9 text-sm"
          />
        </div>
      </div>

      {/* Saved groups. Renders nothing at all until its migration is applied. */}
      <GroupChipRail
        leads={leads}
        activeGroupId={active_group_id}
        onSelect={set_active_group_id}
        groups={groupState.groups}
        setGroups={groupState.setGroups}
        currentUserId={groupState.currentUserId}
        unavailable={groupState.unavailable}
        loading={groupState.loading}
        reload={groupState.reload}
        seedCriteria={seedCriteria}
        advisorOptions={advisors}
      />

      {render_content()}
    </div>
  );

  function render_content() {
    if (component_state === ComponentState.LOADING) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-24">
          <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden />
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-outline">
            Syncing data
          </p>
        </div>
      );
    }

    if (component_state === ComponentState.ERROR) {
      return (
        <div className="mx-auto max-w-md rounded-2xl border border-outline-variant/30 bg-white p-10 text-center shadow-[0_1px_2px_rgba(0,3,33,0.04)]">
          <AlertCircle className="mx-auto mb-4 h-9 w-9 text-error" aria-hidden />
          <h3 className="font-headline text-xl font-extrabold tracking-tighter text-on-secondary-fixed">
            Sync error
          </h3>
          <p className="mb-6 mt-1 text-sm text-on-surface-variant">{error_message}</p>
          <Button
            onClick={fetch_data}
            className="bg-on-secondary-fixed text-primary-fixed hover:bg-on-secondary-fixed/90"
          >
            Retry
          </Button>
        </div>
      );
    }

    if (visible.length === 0) {
      return (
        <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-outline-variant/50 bg-white p-14 text-center">
          <Search className="mx-auto mb-4 h-8 w-8 text-outline/50" aria-hidden />
          <h3 className="font-headline text-xl font-extrabold tracking-tighter text-on-secondary-fixed">
            Nothing here
          </h3>
          <p className="mt-1 text-sm text-on-surface-variant">
            {activeGroup
              ? "No files match this group yet. Adjust its rules, or add files from the list."
              : "Try adjusting your search, or switch tabs."}
          </p>
        </div>
      );
    }

    // Ready is the bucket underwriters act on rather than look up, so it keeps
    // cards. Everything else is a lookup surface and reads far better as rows.
    const asCards = !activeGroup && active_tab === "ready";

    if (asCards) {
      return (
        <div className="grid gap-4 pb-16 md:grid-cols-2">
          {visible.map(lead => (
            <ReadyCard
              key={lead.id}
              lead={lead}
              href={hrefFor(lead)}
              onOpen={router.push}
              groups={groupState.groups}
              currentUserId={groupState.currentUserId}
              onMembershipChange={groupState.patchMembership}
            />
          ))}
        </div>
      );
    }

    return (
      <div className="pb-16">
        <LeadTable
          leads={visible}
          hrefFor={hrefFor}
          onOpen={router.push}
          sortKey={sort_key}
          sortDir={sort_dir}
          onSort={handleSort}
          groups={groupState.groups}
          currentUserId={groupState.currentUserId}
          onMembershipChange={groupState.patchMembership}
        />
      </div>
    );
  }
}
