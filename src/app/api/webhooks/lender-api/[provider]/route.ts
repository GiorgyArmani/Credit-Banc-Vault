// src/app/api/webhooks/lender-api/[provider]/route.ts
//
// POST — a lender telling us a submission changed. The body is NEVER trusted
// for state: we take only the external id, then fetch the status from the
// lender with our own credentials and apply it (same path as "Refresh status").
// Provider.verify() gates the caller (FF: source IP allow-list, no signature).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/lender-api/registry";
import { findSubmissionByExternalId, refreshSubmissionStatus } from "@/lib/lender-api/submissions";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await params;
  const provider = getProvider(providerId);
  if (!provider?.webhook) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await provider.webhook.verify(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const externalId = provider.webhook.extractExternalId(body);
  if (!externalId) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const admin = createAdminClient();
  const submission = await findSubmissionByExternalId(admin, provider.id, externalId);
  // Unknown id: acknowledge so the lender doesn't retry forever; reveal nothing.
  if (!submission) return NextResponse.json({ ok: true });

  try {
    const result = await refreshSubmissionStatus(admin, provider, submission);
    if (result.httpStatus >= 400) {
      console.error(`lender-api webhook: refresh for ${provider.id} returned ${result.httpStatus}`);
    }
  } catch (err) {
    console.error("lender-api webhook refresh error:", err instanceof Error ? err.message : "unknown");
  }
  return NextResponse.json({ ok: true });
}
