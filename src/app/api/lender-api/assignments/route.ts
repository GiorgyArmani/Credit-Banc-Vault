// src/app/api/lender-api/assignments/route.ts
//
// GET ?client_id= — which of this client's lender assignments can be sent by
// API, and the latest submission for each. The client-side pages call this
// because they cannot see env config or run provider matching themselves.

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { providerForLender } from "@/lib/lender-api/registry";
import type { ApiAssignmentSummary } from "@/lib/lender-api/route-helpers";
import { isAssignmentRemoved, submissionErrorKind } from "@/lib/lender-api/rules";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const clientId = new URL(request.url).searchParams.get("client_id") ?? "";
    if (!UUID_RE.test(clientId)) return NextResponse.json({ error: "client_id required" }, { status: 400 });

    const admin = createAdminClient();
    const { data: assignments } = await admin
      .from("client_lender_assignments")
      .select("id, lender_name, decision, admin_review")
      .eq("client_id", clientId);

    const enabled = (assignments ?? [])
      .map((a: any) => ({
        id: a.id as string,
        provider: providerForLender(a.lender_name),
        sendable: !isAssignmentRemoved({ decision: a.decision, admin_review: a.admin_review }),
      }))
      .filter((a) => a.provider);

    const out: Record<string, ApiAssignmentSummary> = {};
    if (enabled.length === 0) return NextResponse.json({ assignments: out });

    const { data: submissions } = await admin
      .from("lender_api_submissions")
      .select("id, assignment_id, status, external_id, reference_id, document_ids, attachments, last_status, error, created_at, updated_at, attempt_no")
      .in("assignment_id", enabled.map((a) => a.id))
      .order("attempt_no", { ascending: false });

    for (const { id, provider, sendable } of enabled) {
      const latest = (submissions ?? []).find((s: any) => s.assignment_id === id) as any;
      out[id] = {
        provider_id: provider!.id,
        display_name: provider!.displayName,
        sendable,
        latest: latest
          ? {
              id: latest.id,
              status: latest.status,
              external_id: latest.external_id,
              reference_id: latest.reference_id,
              documents_total: (latest.document_ids ?? []).length,
              documents_accepted: (latest.attachments ?? []).filter((r: any) => r.accepted).length,
              last_stage: latest.last_status ? provider!.interpretStatus(latest.last_status).stage : null,
              error: latest.error,
              error_kind: submissionErrorKind(latest.error),
              created_at: latest.created_at,
              updated_at: latest.updated_at,
            }
          : null,
      };
    }

    return NextResponse.json({ assignments: out }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("lender-api assignments error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
