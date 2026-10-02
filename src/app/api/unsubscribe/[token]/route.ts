// src/app/api/unsubscribe/[token]/route.ts
//
// RFC 8058 one-click unsubscribe for the post-funding client sequence: the
// target of the List-Unsubscribe header. Mail clients POST here with
// `List-Unsubscribe=One-Click` and expect a 2xx, no page. Humans use
// /unsubscribe/[token]. Token = authorization; see lib/post-funding/unsubscribe.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { unsubscribeClient, verifyUnsubscribeToken } from "@/lib/post-funding/unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const clientVaultId = verifyUnsubscribeToken(token);
  if (!clientVaultId) return NextResponse.json({ error: "Invalid token" }, { status: 400 });

  const ok = await unsubscribeClient(createAdminClient(), clientVaultId);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Unsubscribe failed" }, { status: 500 });
}
