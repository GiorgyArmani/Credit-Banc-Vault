"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PipelineBoard, type PipelineDeal } from "./_components/pipeline-board";
import { getBulkLatestStatus, updateLoanStatus, type LoanStatus } from "@/app/actions/pipeline";
import { getBulkClientActivity } from "@/app/actions/advisor";
import { toast } from "@/lib/toast";
import { Loader2 } from "lucide-react";
import { normalizeSupabaseJoin } from "@/lib/document-scope";

export default function AdvisorPipelinePage() {
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

  const handleDrop = async (dealId: string, newStatus: LoanStatus) => {
    const oldDeals = [...deals];
    setDeals(prev => prev.map(d => (d.id === dealId ? { ...d, pipeline_status: newStatus } : d)));
    try {
      const result = await updateLoanStatus(dealId, newStatus, "Moved in Pipeline");
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
      detailHrefBase="/advisor/dashboard/clients/"
      onDrop={handleDrop}
    />
  );
}

// Bulk-enrich a list of vault rows with status, doc counts, and last-activity.
// Exported so the admin pipeline page can reuse the same logic.
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
  }>
): Promise<PipelineDeal[]> {
  const vaultIds = clients.map(c => c.id);
  const userIds = clients.map(c => c.user_id);

  const [
    statusMap,
    { data: coreDocs },
    { data: dynamicDocsAll },
    { data: uploadedDocsAll },
    { data: subData },
    activityMap,
  ] = await Promise.all([
    getBulkLatestStatus(vaultIds),
    supabase.from("required_documents").select("code").eq("is_core", true),
    supabase
      .from("client_dynamic_documents")
      .select("user_id, required_documents (code)")
      .in("user_id", userIds)
      .eq("is_active", true),
    supabase
      .from("user_documents")
      .select("user_id, category, doc_code")
      .in("user_id", userIds),
    supabase.from("submissions").select("user_id, status").in("user_id", userIds),
    getBulkClientActivity(vaultIds),
  ]);

  const coreCodes = coreDocs?.map(d => d.code) || [];
  const submissionMap = new Map(subData?.map(s => [s.user_id, s.status]) || []);

  const dynamicByUser = new Map<string, string[]>();
  (dynamicDocsAll as any[] | null)?.forEach((row) => {
    // normalizeSupabaseJoin: PostgREST returns the embed as object on some
    // SDKs and a single-element array on others. Without this normalize the
    // dynamic-doc count for every client on this list view reads as zero.
    const doc = normalizeSupabaseJoin<{ code?: string }>(row.required_documents);
    const code = doc?.code;
    if (!code) return;
    const arr = dynamicByUser.get(row.user_id) || [];
    arr.push(code);
    dynamicByUser.set(row.user_id, arr);
  });

  const uploadedByUser = new Map<string, Set<string>>();
  uploadedDocsAll?.forEach((row: any) => {
    const set = uploadedByUser.get(row.user_id) || new Set<string>();
    if (row.category) set.add(row.category);
    if (row.doc_code) set.add(row.doc_code);
    uploadedByUser.set(row.user_id, set);
  });

  return clients.map((client) => {
    const dynamicCodes = dynamicByUser.get(client.user_id) || [];
    const allRequiredCodes = new Set([...coreCodes, ...dynamicCodes]);
    const uploadedCodes = uploadedByUser.get(client.user_id) || new Set<string>();
    const satisfied = Array.from(allRequiredCodes).filter(code => uploadedCodes.has(code)).length;

    const subStatus = submissionMap.get(client.user_id);
    let status = statusMap.get(client.id) || "created";
    if (status === "created" && (subStatus === "submitted" || subStatus === "locked")) {
      status = "under_review";
    }

    return {
      ...client,
      pipeline_status: status as LoanStatus,
      document_count: satisfied,
      total_required_docs: allRequiredCodes.size,
      last_activity_at: activityMap.get(client.id),
    };
  });
}
