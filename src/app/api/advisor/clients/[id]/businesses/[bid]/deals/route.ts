// src/app/api/advisor/clients/[id]/businesses/[bid]/deals/route.ts
//
// POST — open the next funding round for a business (repeat financing).
//
// Why this exists: every funding writer used to resolve "the deal" as the
// business's single funding_deals row and UPDATE it, so a client's second
// financing silently erased the first one's lender, amount, term and date. A
// round is now an explicit object: this endpoint creates the new row, retires
// the closing round's stale paperwork, and re-requests it.
//
// Guards: admin / underwriting, or the client's advisor (owner or follower) —
// including an external partner advisor working their own deal.
// The business must belong to the client, and its current round must be funded
// — a business with an open round doesn't need a new one.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import {
  getActiveDeal,
  getDealsForBusiness,
  isDealFunded,
  startNewFundingRound,
} from "@/lib/funding-deals";
import { CLIENT_SCOPED_DOC_CODES, isCarryOverDoc } from "@/lib/document-scope";
import { recordPipelineTransition } from "@/lib/pipeline-core";
import {
  slackPostMessage,
  getUwUserIds,
  getApproverUserIds,
  resolveAdvisorSlackId,
  formatMentions,
} from "@/lib/slack-api";
import type { FundingDeal } from "@/lib/funding-deals";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLIENT_API_ROLES, isScopedAdvisorRole } from "@/lib/auth/roles";

function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "not set";
  return `$${Math.round(Number(n)).toLocaleString("en-US")}`;
}

/**
 * Posts the new round into the client's Slack deal channel.
 *
 * The round number is derived from display_order: rounds are created at
 * max(display_order) + 1 starting from 0, so order + 1 IS the round number.
 * Never throws — the caller has already created the round, and a Slack outage
 * must not turn that into a failed request.
 */
async function announceNewRound(args: {
  admin: SupabaseClient;
  clientVaultId: string;
  companyName: string | null;
  deal: FundingDeal;
  previousDeal: FundingDeal | null;
  actorUserId: string;
  requestedCount: number;
}): Promise<void> {
  const { admin, clientVaultId, companyName, deal, previousDeal, actorUserId, requestedCount } = args;

  const { data: clientRow } = await admin
    .from("client_data_vault")
    .select("client_name, slack_channel_id, advisors(email)")
    .eq("id", clientVaultId)
    .maybeSingle();

  const channelId = (clientRow as any)?.slack_channel_id as string | null;
  // No channel means this file never had one minted — nothing to announce into.
  if (!channelId) return;

  const { data: actor } = await admin
    .from("users")
    .select("first_name, last_name")
    .eq("id", actorUserId)
    .maybeSingle();
  const actorName = actor
    ? `${(actor as any).first_name ?? ""} ${(actor as any).last_name ?? ""}`.trim()
    : "";

  const advisor = (clientRow as any)?.advisors;
  const advisorEmail = (Array.isArray(advisor) ? advisor[0] : advisor)?.email ?? null;
  const mentions = formatMentions([
    ...getUwUserIds(),
    ...getApproverUserIds(),
    resolveAdvisorSlackId(advisorEmail),
  ]);

  const roundNo = (deal.display_order ?? 0) + 1;
  const label = companyName || (clientRow as any)?.client_name || "this client";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";

  const lines: string[] = [
    `${mentions ? mentions + " " : ""}🔁 *Round ${roundNo} opened* for *${label}*${actorName ? ` by ${actorName}` : ""}.`,
    `• Asking: *${money(deal.capital_requested)}*${deal.proposed_loan_type ? ` · ${deal.proposed_loan_type}` : ""}`,
  ];

  // The prior round's outcome is the context that makes a renewal readable —
  // and it's the record that used to be destroyed by a second funding.
  if (previousDeal?.funded_at) {
    const closedOn = new Date(previousDeal.funded_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    lines.push(
      `• Previous round: funded *${money(previousDeal.funded_amount)}*` +
        `${previousDeal.lender_funded ? ` by ${previousDeal.lender_funded}` : ""}` +
        `${previousDeal.funded_term ? ` · ${previousDeal.funded_term}` : ""} · ${closedOn}`
    );
  }

  lines.push(
    `• ${requestedCount} document${requestedCount === 1 ? "" : "s"} re-requested from the client` +
      ` (identity + entity paperwork carried over).`
  );
  lines.push(`${baseUrl}/admin/clients/${clientVaultId}`);

  await slackPostMessage(channelId, lines.join("\n"));
}

/**
 * Shared gate: authenticates, role-checks, and proves the business belongs to
 * the client. Returns the admin client and the resolved rows, or a response to
 * hand straight back.
 */
async function authorize(clientVaultId: string, businessProfileId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role = userRow?.role;
  if (!role || !(CLIENT_API_ROLES as readonly string[]).includes(role)) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const admin = createAdminClient();

  const { data: client } = await admin
    .from("client_data_vault")
    .select("id, advisor_id, user_id")
    .eq("id", clientVaultId)
    .maybeSingle();
  if (!client) {
    return { ok: false as const, response: NextResponse.json({ error: "Client not found" }, { status: 404 }) };
  }

  // Advisor access gate (admin + underwriting skip it — they work every file).
  // External partner advisors are scoped here exactly like staff advisors.
  if (isScopedAdvisorRole(role)) {
    const { data: me } = await admin
      .from("advisors")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) {
      return { ok: false as const, response: NextResponse.json({ error: "Advisor profile missing" }, { status: 403 }) };
    }

    const isOwner = client.advisor_id === me.id;
    const { data: follower } = await admin
      .from("client_followers")
      .select("id")
      .eq("client_vault_id", clientVaultId)
      .eq("advisor_id", me.id)
      .maybeSingle();

    if (!isOwner && !follower) {
      return { ok: false as const, response: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
    }
  }

  const { data: business } = await admin
    .from("business_profiles")
    .select("id, client_vault_id, company_name")
    .eq("id", businessProfileId)
    .maybeSingle();

  if (!business) {
    return { ok: false as const, response: NextResponse.json({ error: "Business not found" }, { status: 404 }) };
  }
  if (business.client_vault_id !== clientVaultId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Business does not belong to this client" }, { status: 400 }),
    };
  }

  return { ok: true as const, admin, client, business, user, role };
}

// GET — every funding round for this business, newest first, each with the
// lenders it was shopped to and what they said. Drives the rounds card on the
// client detail pages.
//
// The lender rows ride along on this response rather than getting their own
// endpoint: they are meaningless without the rounds to hang them on (the round
// NUMBER is derived from position in this same ordered list), and two requests
// racing each other could render lenders against a stale set of rounds.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; bid: string }> }
) {
  const { id: clientVaultId, bid: businessProfileId } = await params;

  const gate = await authorize(clientVaultId, businessProfileId);
  if (!gate.ok) return gate.response;

  const deals = await getDealsForBusiness(gate.admin, businessProfileId);

  // Scoped by client, then narrowed to this business OR unattributed. Legacy
  // rows carry neither a business nor a round (see the retire note in POST);
  // dropping them would hide most of the history that exists today.
  const { data: lenders, error: lenderErr } = await gate.admin
    .from("client_lender_assignments")
    .select(
      "id, lender_name, specialty, tier_label, status, response_notes, funding_deal_id, business_profile_id, assigned_at, submitted_at, responded_at, admin_review"
    )
    .eq("client_id", clientVaultId)
    .or(`business_profile_id.eq.${businessProfileId},business_profile_id.is.null`)
    .order("assigned_at", { ascending: false });

  if (lenderErr) {
    // Never fail the rounds list over the lender panel — the card's primary
    // job is the round history, and an empty lender list degrades to the
    // pre-existing behaviour rather than a broken page.
    console.error("deals GET: lender assignments read failed:", lenderErr);
  }

  return NextResponse.json({ success: true, deals, lenders: lenders ?? [] });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; bid: string }> }
) {
  const { id: clientVaultId, bid: businessProfileId } = await params;

  const gate = await authorize(clientVaultId, businessProfileId);
  if (!gate.ok) return gate.response;
  const { admin, client, business, user, role } = gate;

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    /* an empty body is valid — everything below is optional */
  }

  const closingDeal = await getActiveDeal(admin, businessProfileId);
  if (closingDeal && !isDealFunded(closingDeal)) {
    return NextResponse.json(
      {
        error:
          "This business already has an open funding round. Fund or close it before starting another.",
      },
      { status: 409 }
    );
  }

  const numericOrNull = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(String(v).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  const opened = await startNewFundingRound(admin, businessProfileId, {
    capital_requested: numericOrNull(body.capital_requested),
    proposed_loan_type: body.proposed_loan_type || null,
    loan_purpose: body.loan_purpose || null,
  });

  if (!opened.deal) {
    return NextResponse.json({ error: opened.error }, { status: 500 });
  }
  const newDeal = opened.deal;

  // ── Retire the closing round's paperwork ────────────────────────────────
  // Stamping the OLD deal's id onto its rows is what retires them: the read
  // predicate (matchesActiveDeal) treats a foreign round's id as "not this
  // round" and a NULL as "every round". Carry-over codes are left NULL on
  // purpose so the client isn't asked for their driver's licence again.
  let retiredDocs = 0;
  if (closingDeal) {
    // The carry-over test runs in JS, not as a PostgREST `not.in` filter: a row
    // with a NULL doc_code makes `NOT (NULL IN (...))` evaluate to NULL, which
    // silently drops it from the update — exactly the rows that most need
    // retiring. Selecting first also gives an honest count to report back.
    const { data: priorDocRows } = await admin
      .from("user_documents")
      .select("id, doc_code, category")
      .eq("business_profile_id", businessProfileId)
      .is("funding_deal_id", null);

    const staleDocIds = (priorDocRows ?? [])
      .filter((d: any) => !isCarryOverDoc((d.doc_code ?? d.category ?? null) as string | null))
      .map((d: any) => d.id as string);

    if (staleDocIds.length > 0) {
      const { error: stampErr } = await admin
        .from("user_documents")
        .update({ funding_deal_id: closingDeal.id })
        .in("id", staleDocIds);
      if (stampErr) {
        console.error("startNewRound: failed to retire documents:", stampErr);
      } else {
        retiredDocs = staleDocIds.length;
      }
    }

    // Approvals follow their documents — the new round starts unapproved for
    // everything it will re-collect, so the review packet reads honestly.
    const { data: priorApprovals } = await admin
      .from("document_category_approvals")
      .select("id, doc_code")
      .eq("business_profile_id", businessProfileId)
      .is("funding_deal_id", null);

    const staleApprovalIds = (priorApprovals ?? [])
      .filter((a: any) => !isCarryOverDoc(a.doc_code as string | null))
      .map((a: any) => a.id as string);

    if (staleApprovalIds.length > 0) {
      const { error: apprErr } = await admin
        .from("document_category_approvals")
        .update({ funding_deal_id: closingDeal.id })
        .in("id", staleApprovalIds);
      if (apprErr) {
        console.error("startNewRound: failed to retire approvals:", apprErr);
      }
    }

    // Lender submissions retire the same way, and this is the one that makes
    // the deal track work: every lender we went to, and everything they said,
    // gets pinned to the round it happened in at the moment the next one opens.
    //
    // Unlike documents there is no carry-over list — a lender response belongs
    // to the file it was given on, always. Rows written since 20260902 already
    // carry their own funding_deal_id and are skipped by the NULL filter.
    //
    // business_profile_id is NULL on older rows (8 in prod at the time of
    // writing), so those are matched by client_id alone. That is only ambiguous
    // for a client with more than one business — 3 vaults out of 179 — and the
    // alternative is leaving them unattributed forever, which is worse: they
    // would then show under every future round.
    const { error: lenderErr, count: retiredLenders } = await admin
      .from("client_lender_assignments")
      .update({ funding_deal_id: closingDeal.id }, { count: "exact" })
      .eq("client_id", clientVaultId)
      .is("funding_deal_id", null)
      .or(`business_profile_id.eq.${businessProfileId},business_profile_id.is.null`);
    if (lenderErr) {
      console.error("startNewRound: failed to retire lender assignments:", lenderErr);
    } else if (retiredLenders) {
      console.info(`startNewRound: retired ${retiredLenders} lender assignments to the closing round`);
    }
  }

  // ── Re-request the stale documents ──────────────────────────────────────
  // Explicit list from the modal, else every non-carry-over code the previous
  // round actually collected. Client-scoped codes are stripped for the same
  // reason as the add-business flow: they belong to the person, not the deal.
  let requestedCodes: string[] = Array.isArray(body.requested_doc_codes)
    ? body.requested_doc_codes.filter((c: unknown): c is string => typeof c === "string")
    : [];

  if (requestedCodes.length === 0) {
    const { data: priorDocs } = await admin
      .from("user_documents")
      .select("doc_code, category")
      .eq("business_profile_id", businessProfileId);
    requestedCodes = Array.from(
      new Set(
        (priorDocs ?? [])
          .map((d: any) => (d.doc_code ?? d.category ?? null) as string | null)
          .filter((c): c is string => !!c)
      )
    );
  }

  requestedCodes = requestedCodes.filter(
    (code) =>
      !isCarryOverDoc(code) &&
      !CLIENT_SCOPED_DOC_CODES.includes(code as any) &&
      // The round's contract is minted by Signwell, not requested from the
      // client as an upload.
      code !== "funding_application"
  );

  let requestedCount = 0;
  if (requestedCodes.length > 0) {
    const { data: docDefs } = await admin
      .from("required_documents")
      .select("id, code")
      .in("code", requestedCodes);

    if (docDefs && docDefs.length > 0) {
      const rows = docDefs.map((d: any) => ({
        user_id: client.user_id,
        document_id: d.id,
        business_profile_id: businessProfileId,
        funding_deal_id: newDeal.id,
        is_active: true,
        requested_at: new Date().toISOString(),
        requested_via: "new_funding_round",
      }));
      // Same conflict target as the add-business flow: requests are per
      // business + document, so this refreshes the existing row onto the new
      // round rather than stacking duplicates.
      const { error: reqErr } = await admin
        .from("client_dynamic_documents")
        .upsert(rows, { onConflict: "business_profile_id, document_id" });
      if (reqErr) {
        console.error("startNewRound: failed to request documents:", reqErr);
      } else {
        requestedCount = rows.length;
      }
    }
  }

  // ── Put the client back on the board ────────────────────────────────────
  // Written through pipeline-core rather than updateLoanStatus: this runs in an
  // API route where the actor is already resolved, and the status is fixed by
  // the route (never caller-supplied).
  const transition = await recordPipelineTransition({
    clientVaultId,
    newStatus: "documents_requested",
    note: `New funding round opened for ${business.company_name || "business"}`,
    actorUserId: user.id,
    actorRole: role,
    fundingDealId: newDeal.id,
  });
  if (!transition.success) {
    console.error("startNewRound: pipeline transition failed:", transition.error);
  }

  // ── Announce it in the deal's Slack channel ─────────────────────────────
  // A repeat file re-entering the pipeline is exactly the event UW would
  // otherwise learn about by noticing documents appear. Best-effort: Slack
  // being down must never fail the round that was already created.
  try {
    await announceNewRound({
      admin,
      clientVaultId,
      companyName: business.company_name ?? null,
      deal: newDeal,
      previousDeal: opened.previous,
      actorUserId: user.id,
      requestedCount,
    });
  } catch (err) {
    console.error("startNewRound: Slack announcement failed (non-fatal):", err);
  }

  revalidatePath(`/advisor/dashboard/clients/${clientVaultId}`);
  revalidatePath(`/underwriting/dashboard/clients/${clientVaultId}`);
  revalidatePath(`/admin/clients/${clientVaultId}`);

  return NextResponse.json({
    success: true,
    deal: newDeal,
    retired_documents: retiredDocs,
    requested_documents: requestedCount,
  });
}
