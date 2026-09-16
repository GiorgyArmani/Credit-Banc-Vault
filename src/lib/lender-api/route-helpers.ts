// src/lib/lender-api/route-helpers.ts
import { NextResponse } from "next/server";
import { resolveRecorderName } from "@/lib/lender-response-history";
import type { TransitionActor } from "@/lib/lender-assignment-transitions";
import { providerForLender } from "./registry";
import type { SubmissionErrorKind } from "./rules";
import type { AdminClient } from "./source";
import type { LenderApiProvider } from "./types";

export interface ApiAssignmentSummary {
  provider_id: string;
  display_name: string;
  /** Still approved and not removed from the file — a send is allowed at all. */
  sendable: boolean;
  latest: {
    id: string;
    status: string;
    external_id: string | null;
    reference_id: string;
    documents_total: number;
    documents_accepted: number;
    last_stage: string | null;
    error: string | null;
    error_kind: SubmissionErrorKind | null;
    created_at: string;
    updated_at: string;
  } | null;
}

/** One 404 for "no such assignment", "no provider" and "provider not configured". */
export function notAvailable(): NextResponse {
  return NextResponse.json({ error: "Not available" }, { status: 404 });
}

export async function resolveProviderForAssignment(
  admin: AdminClient,
  assignmentId: string
): Promise<LenderApiProvider | null> {
  const { data } = await admin
    .from("client_lender_assignments")
    .select("lender_name")
    .eq("id", assignmentId)
    .maybeSingle();
  return providerForLender(data?.lender_name ?? null);
}

export async function staffActor(admin: AdminClient, userId: string): Promise<TransitionActor> {
  return { id: userId, name: await resolveRecorderName(admin, userId) };
}
