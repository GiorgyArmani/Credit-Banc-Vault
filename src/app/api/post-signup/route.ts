// app/api/post-signup/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncUnifiedClientData } from "@/lib/user-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,                // ✅ privada, no NEXT_PUBLIC
  process.env.SUPABASE_SERVICE_ROLE_KEY!,   // ✅ service role
  { auth: { persistSession: false } }
);

// Utilidad: crear o actualizar contacto en GHL
async function upsertGHLContact({
  firstName,
  lastName,
  email,
  tags = [],
}: {
  firstName: string;
  lastName: string;
  email: string;
  tags?: string[];
}) {
  const endpoint = "https://services.leadconnectorhq.com/contacts/upsert";
  const payload = {
    firstName,
    lastName,
    email,
    locationId: process.env.GHL_LOCATION_ID,
    source: "creditbanc-signup",
    tags,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL upsert failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    const { userId, firstName, lastName, email, tags } = await req.json();

    if (!userId || !firstName || !lastName || !email) {
      return NextResponse.json({ message: "Missing fields" }, { status: 400 });
    }

    // 1) Sync to Unified Tables (users, client_data_vault, business_profiles)
    await syncUnifiedClientData(supabaseAdmin, {
      userId,
      email: email.toLowerCase(),
      clientName: `${firstName} ${lastName}`.trim(),
      companyName: firstName + "'s Business", // Fallback name
      role: 'free',
    });
    console.log(`✅ Unified sync completed for user: ${userId}`);

    // 2) Upsert contacto en GHL
    // Always include 'vault-user' so GHL automations trigger correctly,
    // regardless of what tags the caller provides.
    const mergedTags = [...new Set(['vault-user', ...(tags || [])])];
    await upsertGHLContact({ firstName, lastName, email, tags: mergedTags });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("post-signup error:", err);
    return NextResponse.json(
      { message: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
