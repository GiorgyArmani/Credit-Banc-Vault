// src/app/api/webhooks/lender-api/[provider]/route.ts
//
// POST — a lender telling us a submission changed. The body is NEVER trusted
// for state: we take only the external id, then fetch the status from the
// lender with our own credentials and apply it (same path as "Refresh status").
// Provider.verify() gates the caller (FF: source IP allow-list, no signature).
//
// The one exception is a lender with no status API at all (Loot): there is
// nothing to re-fetch, so the status comes from the body — and only after
// verify() has checked its signature.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/lender-api/registry";
import { applyPushedStatus, findSubmissionByExternalId, refreshSubmissionStatus } from "@/lib/lender-api/submissions";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await params;
  const provider = getProvider(providerId);
  if (!provider?.webhook) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await provider.webhook.verify(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Proof of delivery when validating a new lender's webhook. No body: it can carry PII.
  console.info(`lender-api webhook: ${provider.id} callback verified`);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  let externalId: string | null;
  if (provider.webhook.resolveExternalId) {
    // A lookup against the lender: a throw means the lookup itself failed
    // (their API down / erroring) — answer 5xx so the lender retries. null
    // means nothing on their side maps to a submission: acknowledge it, the
    // same as an unknown id below, so they don't retry forever.
    try {
      externalId = await provider.webhook.resolveExternalId(body);
    } catch (err) {
      console.error(`lender-api webhook: ${provider.id} id lookup failed:`, err instanceof Error ? err.message : "unknown");
      return NextResponse.json({ error: "Retry later" }, { status: 503 });
    }
    if (!externalId) return NextResponse.json({ ok: true });
  } else {
    externalId = provider.webhook.extractExternalId(body);
    if (!externalId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const admin = createAdminClient();
  const submission = await findSubmissionByExternalId(admin, provider.id, externalId);
  // Unknown id: acknowledge so the lender doesn't retry forever; reveal nothing.
  if (!submission) return NextResponse.json({ ok: true });

  try {
    let result;
    if (provider.fetchStatus) {
      result = await refreshSubmissionStatus(admin, provider, submission);
    } else {
      const pushed = provider.webhook.statusFromBody?.(body) ?? null;
      // An event that carries no decision (e.g. draw information) — nothing to apply.
      if (pushed === null) return NextResponse.json({ ok: true });
      result = await applyPushedStatus(admin, provider, submission, pushed);
    }
    if (result.httpStatus >= 400) {
      console.error(`lender-api webhook: refresh for ${provider.id} returned ${result.httpStatus}`);
    }
    // Our own failure: answer 5xx so the lender retries (Loot: 3 tries at
    // 1/2/4 min). Applying is idempotent — an unchanged status never
    // re-notifies and an already-recorded verdict is a no-op. A 4xx (e.g. the
    // assignment is gone) would fail the same way every time, so ack it.
    if (result.httpStatus >= 500) return NextResponse.json({ error: "Retry later" }, { status: 503 });
  } catch (err) {
    console.error("lender-api webhook refresh error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Retry later" }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
