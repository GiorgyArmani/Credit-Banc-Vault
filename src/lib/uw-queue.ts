// src/lib/uw-queue.ts
//
// Builds the UW dashboard queue on the SERVER: one GroupableLead per vault.
//
// The dashboard used to run these reads in the browser, one after another, and
// pull every raw row (≈3k uploads, ≈1.7k requirement rows, all history) just to
// count them. Two problems: it got slower with every client, and PostgREST cut
// each read at 1000 rows without an error, so document counts were wrong once
// uploads passed 1000 (they are at 3,114). Here every read is paged, they run
// in parallel, and the browser receives only the ~one small row per vault.
//
// UW and admin see every file, so no read is filtered by a vault-id list (a
// long `.in()` list also breaks the request URL as the book grows).

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { normalizeSupabaseJoin } from "@/lib/document-scope";
import { LENDER_DOCUMENTATION_DOC_CODE } from "@/lib/document-groups";
import type { GroupableLead, LeadBucket } from "@/lib/lead-groups";
import type { LoanStatus } from "@/app/actions/pipeline";

export interface UwQueueRows {
  vaults: {
    id: string;
    user_id: string;
    client_name: string;
    client_email: string;
    company_name: string;
    company_state: string | null;
    credit_score: string | null;
    capital_requested: number;
    created_at: string;
    advisor_id: string | null;
    advisors: unknown;
    business_profiles: { company_name: string | null }[] | null;
  }[];
  submissions: { user_id: string; status: string; submitted_at: string | null }[];
  /** Newest first. */
  history: { client_vault_id: string; status: string }[];
  dynamicDocs: { user_id: string; required_documents: unknown }[];
  uploads: { user_id: string; category: string | null; doc_code: string | null }[];
  approvals: { client_vault_id: string; doc_code: string | null }[];
  waitingLenders: { client_id: string; submitted_at: string | null; assigned_at: string | null; created_at: string }[];
}

export interface UwQueue {
  leads: GroupableLead[];
  advisors: { id: string; name: string }[];
}

const daysBetween = (iso: string | null | undefined, now: number) => {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  return Number.isNaN(then) ? 0 : Math.max(0, Math.floor((now - then) / 86_400_000));
};

function addTo<K>(map: Map<K, Set<string>>, key: K, value: string | null | undefined) {
  if (!value) return;
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}

export function buildUwQueue(rows: UwQueueRows, now = Date.now()): UwQueue {
  const submissionByUser = new Map(rows.submissions.map((s) => [s.user_id, s]));

  const latestStatus = new Map<string, LoanStatus>();
  for (const h of rows.history) {
    if (!latestStatus.has(h.client_vault_id)) latestStatus.set(h.client_vault_id, h.status as LoanStatus);
  }

  // client_dynamic_documents IS the requirement set (program packages are
  // materialized into it at creation). Lender Documentation is never required.
  const requiredByUser = new Map<string, Set<string>>();
  for (const d of rows.dynamicDocs) {
    const code = normalizeSupabaseJoin<{ code?: string }>(d.required_documents as any)?.code;
    if (code && code !== LENDER_DOCUMENTATION_DOC_CODE) addTo(requiredByUser, d.user_id, code);
  }

  const uploadedByUser = new Map<string, Set<string>>();
  for (const u of rows.uploads) {
    addTo(uploadedByUser, u.user_id, u.category);
    addTo(uploadedByUser, u.user_id, u.doc_code);
  }

  // Approval is what "done" means (same rule as the vault_completed tag).
  const approvedByVault = new Map<string, Set<string>>();
  for (const a of rows.approvals) addTo(approvedByVault, a.client_vault_id, a.doc_code);

  const lenderWait = new Map<string, { count: number; days: number }>();
  for (const w of rows.waitingLenders) {
    const days = daysBetween(w.submitted_at ?? w.assigned_at ?? w.created_at, now);
    const cur = lenderWait.get(w.client_id) ?? { count: 0, days: 0 };
    lenderWait.set(w.client_id, { count: cur.count + 1, days: Math.max(cur.days, days) });
  }

  const advisorNames = new Map<string, string>();
  const leads: GroupableLead[] = [];

  for (const client of rows.vaults) {
    const sub = submissionByUser.get(client.user_id);
    const advisor = normalizeSupabaseJoin<{ first_name?: string; last_name?: string }>(client.advisors as any);
    const pStatus = latestStatus.get(client.id) ?? "created";

    const required = requiredByUser.get(client.user_id) ?? new Set<string>();
    const uploaded = uploadedByUser.get(client.user_id) ?? new Set<string>();
    const approved = approvedByVault.get(client.id) ?? new Set<string>();
    let docsApproved = 0;
    let docsAwaiting = 0;
    for (const code of required) {
      if (approved.has(code)) docsApproved += 1;
      else if (uploaded.has(code)) docsAwaiting += 1;
    }

    // Pipeline status wins; the submission lock separates "ready for review"
    // from "still filling in".
    const bucket: LeadBucket =
      pStatus === "funded" ? "funded"
        : pStatus === "declined" ? "declined"
          : sub?.status === "locked" ? "ready"
            : "active";

    const advisor_name = advisor
      ? `${advisor.first_name ?? ""} ${advisor.last_name ?? ""}`.trim() || "Unknown Advisor"
      : "Unknown Advisor";
    if (client.advisor_id && advisor) advisorNames.set(client.advisor_id, advisor_name);

    leads.push({
      id: client.id,
      bucket,
      pipeline_status: pStatus,
      advisor_id: client.advisor_id ?? null,
      capital_requested: client.capital_requested,
      docs_approved: docsApproved,
      docs_total: required.size,
      docs_awaiting_review: docsAwaiting,
      age_days: daysBetween(sub?.submitted_at || client.created_at, now),
      company_state: client.company_state,
      credit_score: client.credit_score,
      client_name: client.client_name,
      client_email: client.client_email,
      company_name: client.company_name,
      business_names: (client.business_profiles ?? []).map((b) => b.company_name ?? "").join(" "),
      lenders_waiting: lenderWait.get(client.id)?.count ?? 0,
      lender_wait_days: lenderWait.get(client.id)?.days ?? 0,
      advisor_name,
    });
  }

  return {
    leads,
    advisors: Array.from(advisorNames, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Every read the queue needs, paged and in parallel. Throws on any read error
 *  — a partial queue would put files in the wrong tab. */
export async function loadUwQueueRows(db: SupabaseClient): Promise<UwQueueRows> {
  const results = await Promise.all([
    fetchAllRows<UwQueueRows["vaults"][number]>(() =>
      db.from("client_data_vault")
        .select(`id, user_id, client_name, client_email, company_name, company_state, credit_score,
                 capital_requested, created_at, advisor_id,
                 advisors!client_data_vault_advisor_id_fkey ( first_name, last_name ),
                 business_profiles ( company_name )`)
        .order("created_at", { ascending: false })
        .order("id")
    ),
    fetchAllRows<UwQueueRows["submissions"][number]>(() =>
      db.from("submissions").select("user_id, status, submitted_at").order("id")
    ),
    fetchAllRows<UwQueueRows["history"][number]>(() =>
      db.from("loan_status_history")
        .select("client_vault_id, status")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
    ),
    fetchAllRows<UwQueueRows["dynamicDocs"][number]>(() =>
      db.from("client_dynamic_documents").select("user_id, required_documents(code)").eq("is_active", true).order("id")
    ),
    fetchAllRows<UwQueueRows["uploads"][number]>(() =>
      db.from("user_documents").select("user_id, category, doc_code").order("id")
    ),
    fetchAllRows<UwQueueRows["approvals"][number]>(() =>
      db.from("document_category_approvals").select("client_vault_id, doc_code").order("id")
    ),
    fetchAllRows<UwQueueRows["waitingLenders"][number]>(() =>
      db.from("client_lender_assignments")
        .select("client_id, submitted_at, assigned_at, created_at")
        .eq("status", "submitted")
        .order("id")
    ),
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
  const [vaults, submissions, history, dynamicDocs, uploads, approvals, waitingLenders] = results.map((r) => r.data);
  return {
    vaults, submissions, history, dynamicDocs, uploads, approvals, waitingLenders,
  } as UwQueueRows;
}
