// app/api/post-signup/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
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
    // Identity comes from the session, never the body. This route is public in
    // the proxy and writes with the service role, so trusting a body userId/email
    // let anyone rewrite any user's email (→ magic-link takeover) or role.
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const userId = user.id;
    const email = user.email.toLowerCase();

    const { firstName, lastName } = await req.json();

    if (!firstName || !lastName) {
      return NextResponse.json({ message: "Missing fields" }, { status: 400 });
    }

    // 1) Sync to Unified Tables (users, client_data_vault, business_profiles).
    //    No `role`: a fresh insert defaults to 'free', and an existing user's
    //    role must never be rewritten from here.
    await syncUnifiedClientData(supabaseAdmin, {
      userId,
      email,
      clientName: `${firstName} ${lastName}`.trim(),
      companyName: firstName + "'s Business", // Fallback name
    });
    console.log(`✅ Unified sync completed for user: ${userId}`);

    // 2) Upsert contacto en GHL. Tags are fixed server-side — caller-supplied
    //    tags could fire arbitrary GHL workflows.
    await upsertGHLContact({ firstName, lastName, email, tags: ['vault-user', 'repair-dashboard'] });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("post-signup error:", err);
    return NextResponse.json(
      { message: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
