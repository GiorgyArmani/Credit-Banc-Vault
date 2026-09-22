"use client";

// The pipeline kanban, shared by the advisor portal and the partner deal desk.
//
// Both portals render this same component; only `basePath` differs, which is
// what makes a card link back into the right client file. See
// src/components/workspace/README.md for the pattern.
//
// Scoping is owner ∪ follower, resolved from the caller's `advisors` row. That
// is application-side convenience, NOT the security boundary — RLS enforces the
// same bound independently via is_assigned_advisor_for(), which is what lets an
// external partner_advisor run this component safely.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PipelineBoard, type PipelineDeal } from "@/app/advisor/dashboard/pipeline/_components/pipeline-board";
import { getBulkPipelineHistory, updateLoanStatus, type LoanStatus } from "@/app/actions/pipeline";
import { latestPipelineStatus, scopePipelineHistory } from "@/components/client-file/pipeline-scope";
import { getBulkClientActivity } from "@/app/actions/advisor";
import { toast } from "@/lib/toast";
import { Loader2 } from "lucide-react";
import { isClientScopedDoc, normalizeSupabaseJoin } from "@/lib/document-scope";

export function WorkspacePipeline({ basePath }: { basePath: string }) {
  const supabase = createClient();
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDeals = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: advisor } = await supabase
        .from("advisors")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!advisor?.id) {
        setDeals([]);
        return;
      }

      const [{ data: owned }, { data: followed }] = await Promise.all([
        supabase.from("client_data_vault").select("id").eq("advisor_id", advisor.id),
        supabase.from("client_followers").select("client_vault_id").eq("advisor_id", advisor.id),
      ]);

      const idSet = new Set<string>();
      owned?.forEach(r => idSet.add(r.id));
      followed?.forEach((r: any) => idSet.add(r.client_vault_id));

      if (idSet.size === 0) {
        setDeals([]);
        return;
      }

      const { data: clients, error } = await supabase
        .from("client_data_vault")
        .select("id, user_id, advisor_id, client_name, client_email, client_phone, company_name, capital_requested, created_at, reassigned_to_catch_all_at, reassignment_paused_until")
        .in("id", Array.from(idSet));

      if (error) throw error;
      if (!clients || clients.length === 0) {
        setDeals([]);
        return;
      }

      const enriched = await enrichDeals(supabase, clients);
      setDeals(enriched);
    } catch (error: any) {
      toast.error("Failed to load pipeline: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeals();
    import("drag-drop-touch");
  }, []);

  // `cardKey` names one business's card; the move is stamped with that
  // business's round so it never drags the client's other business along.
  const handleDrop = async (cardKey: string, newStatus: LoanStatus) => {
    const card = deals.find(d => d.card_key === cardKey);
    if (!card) return;
    const oldDeals = [...deals];
    setDeals(prev => prev.map(d => (d.card_key === cardKey ? { ...d, pipeline_status: newStatus } : d)));
    try {
      const result = await updateLoanStatus(card.id, newStatus, "Moved in Pipeline", card.funding_deal_id);
      if (!result.success) throw new Error(result.error);
      toast.success("Deal status updated!");
    } catch (error: any) {
      setDeals(oldDeals);
      toast.error("Failed to update status: " + error.message);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 text-emerald-500 animate-spin mb-4" />
        <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Synchronizing Pipeline...</p>
      </div>
    );
  }

  return (
    <PipelineBoard
      deals={deals}
      detailHrefBase={`${basePath}/clients/`}
      onDrop={handleDrop}
    />
  );
}

// Bulk-enrich a list of vault rows with status, doc counts, and last-activity.
// Exported so the admin pipeline page can reuse the same logic.
//
// ONE CARD PER BUSINESS. A client with two businesses is two deals — usually
// the first was funded or declined and the second is a fresh application — so
// each business gets its own card with its own stage (history rows scoped by
// business_profile_id, unstamped rows = primary; see pipeline-scope.ts), its
// own funding ask and its own document count. A single-business client stays
// one card exactly as before. `id` is always the VAULT id (links, pause
// control, prev/next); `card_key` tells a client's cards apart.
export async function enrichDeals(
  supabase: ReturnType<typeof createClient>,
  clients: Array<{
    id: string;
    user_id: string;
    advisor_id: string | null;
    client_name: string;
    client_email: string;
    client_phone: string;
    company_name: string;
    capital_requested: number;
    created_at: string;
    reassigned_to_catch_all_at?: string | null;
    reassignment_paused_until?: string | null;
    referral_partner?: string | null;
  }>
): Promise<PipelineDeal[]> {
  const vaultIds = clients.map(c => c.id);
  const userIds = clients.map(c => c.user_id);

  const [
    historyRows,
    { data: coreDocs },
    { data: dynamicDocsAll },
    { data: uploadedDocsAll },
    { data: subData },
    { data: businessRows },
    activityMap,
  ] = await Promise.all([
    getBulkPipelineHistory(vaultIds),
    supabase.from("required_documents").select("code").eq("is_core", true),
    supabase
      .from("client_dynamic_documents")
      .select("user_id, business_profile_id, required_documents (code)")
      .in("user_id", userIds)
      .eq("is_active", true),
    supabase
      .from("user_documents")
      .select("user_id, business_profile_id, category, doc_code")
      .in("user_id", userIds),
    supabase.from("submissions").select("user_id, status").in("user_id", userIds),
    supabase
      .from("business_profiles")
      .select("id, client_vault_id, company_name, is_primary, created_at, funding_deals (id, capital_requested, display_order, created_at)")
      .in("client_vault_id", vaultIds),
    getBulkClientActivity(vaultIds),
  ]);

  const coreCodes = coreDocs?.map(d => d.code) || [];
  const submissionMap = new Map(subData?.map(s => [s.user_id, s.status]) || []);

  const historyByVault = new Map<string, typeof historyRows>();
  for (const row of historyRows) {
    const arr = historyByVault.get(row.client_vault_id) || [];
    arr.push(row);
    historyByVault.set(row.client_vault_id, arr);
  }

  type BusinessRow = {
    id: string;
    client_vault_id: string;
    company_name: string | null;
    is_primary: boolean;
    created_at: string;
    funding_deals: { id: string; capital_requested: number | null; display_order: number | null; created_at: string }[] | null;
  };
  const businessesByVault = new Map<string, BusinessRow[]>();
  for (const b of (businessRows as BusinessRow[] | null) || []) {
    const arr = businessesByVault.get(b.client_vault_id) || [];
    arr.push(b);
    businessesByVault.set(b.client_vault_id, arr);
  }

  // Rows keep their business so each card counts only its own documents.
  const dynamicByUser = new Map<string, { code: string; bp: string | null }[]>();
  (dynamicDocsAll as any[] | null)?.forEach((row) => {
    // normalizeSupabaseJoin: PostgREST returns the embed as object on some
    // SDKs and a single-element array on others. Without this normalize the
    // dynamic-doc count for every client on this list view reads as zero.
    const doc = normalizeSupabaseJoin<{ code?: string }>(row.required_documents);
    const code = doc?.code;
    if (!code) return;
    const arr = dynamicByUser.get(row.user_id) || [];
    arr.push({ code, bp: row.business_profile_id ?? null });
    dynamicByUser.set(row.user_id, arr);
  });

  const uploadedByUser = new Map<string, { code: string; bp: string | null }[]>();
  uploadedDocsAll?.forEach((row: any) => {
    const arr = uploadedByUser.get(row.user_id) || [];
    const bp = row.business_profile_id ?? null;
    if (row.category) arr.push({ code: row.category, bp });
    if (row.doc_code) arr.push({ code: row.doc_code, bp });
    uploadedByUser.set(row.user_id, arr);
  });

  return clients.flatMap((client): PipelineDeal[] => {
    const businesses = (businessesByVault.get(client.id) || [])
      .slice()
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.created_at.localeCompare(b.created_at));
    const multi = businesses.length > 1;
    const history = historyByVault.get(client.id) || [];
    const dynamic = dynamicByUser.get(client.user_id) || [];
    const uploaded = uploadedByUser.get(client.user_id) || [];

    // A single-business (or legacy, business-less) client is one card over all
    // of its rows — unchanged behaviour. `null` stands for "the whole client".
    const cards: (BusinessRow | null)[] = multi ? businesses : [businesses[0] ?? null];

    return cards.map((business): PipelineDeal => {
      // Does a row stamped with `bp` belong on this card? Client-scoped docs
      // (licence, PFS, MyScoreIQ) describe the person, so every card has them.
      const onCard = (bp: string | null, code?: string) =>
        !multi || !business || isClientScopedDoc(code) || (bp ? bp === business.id : business.is_primary);

      const allRequiredCodes = new Set([
        ...coreCodes,
        ...dynamic.filter(d => onCard(d.bp, d.code)).map(d => d.code),
      ]);
      const uploadedCodes = new Set(uploaded.filter(u => onCard(u.bp, u.code)).map(u => u.code));
      const satisfied = Array.from(allRequiredCodes).filter(code => uploadedCodes.has(code)).length;

      const scoped = scopePipelineHistory(history, business, multi ? businesses.length : 1);
      let status = latestPipelineStatus(scoped) as LoanStatus;
      // The submissions row is per client, so it can only speak for the
      // client's main business.
      const subStatus = submissionMap.get(client.user_id);
      if (status === "created" && (!multi || business?.is_primary) && (subStatus === "submitted" || subStatus === "locked")) {
        status = "under_review";
      }

      const deal = (business?.funding_deals || [])
        .slice()
        .sort((a, b) => (b.display_order ?? 0) - (a.display_order ?? 0) || b.created_at.localeCompare(a.created_at))[0];

      return {
        ...client,
        card_key: multi && business ? `${client.id}:${business.id}` : client.id,
        business_profile_id: business?.id ?? null,
        funding_deal_id: deal?.id ?? null,
        company_name: multi && business ? business.company_name || client.company_name : client.company_name,
        capital_requested: multi && deal ? Number(deal.capital_requested ?? 0) : client.capital_requested,
        created_at: multi && business && !business.is_primary ? business.created_at : client.created_at,
        pipeline_status: status,
        document_count: satisfied,
        total_required_docs: allRequiredCodes.size,
        last_activity_at: activityMap.get(client.id),
      };
    });
  });
}
