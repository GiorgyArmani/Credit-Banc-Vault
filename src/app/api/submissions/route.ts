import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await req.json();

  // Security: Verify that the userId in the request matches the authenticated user
  if (userId !== user.id) {
    console.error(`❌ Security Violation: User ${user.id} attempted to submit for user ${userId}`);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Use admin client for DB operations after identity is verified
  const { createClient: createAdminClient } = await import("@supabase/supabase-js");
  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const { data: bp } = await admin.from("business_profiles").select("id").eq("user_id", userId).single();
  const profileId = bp!.id;

  const miss = await (await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/missing?userId=${userId}`)).json();
  if (miss.some((m: any) => m.needed > 0)) return NextResponse.json({ error: "missing_docs" }, { status: 400 });

  await admin.from("events").insert({ profile_id: profileId, type: "submit" });

  // tag en GHL (si tienes integrations/ghl_contact_id)
  const { data: integ } = await admin.from("integrations").select("ghl_contact_id").eq("profile_id", profileId).maybeSingle();
  if (integ?.ghl_contact_id) {
    fetch(`https://services.leadconnectorhq.com/contacts/${integ.ghl_contact_id}/tags`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GHL_TOKEN!}`, Version: "2021-07-28", "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["vault_submitted"] })
    }).catch(() => { });
  }

  return NextResponse.json({ ok: true });
}
// Si hay error: { error:"missing_docs" } (400)
// Si todo ok: { ok:true }