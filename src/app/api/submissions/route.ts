import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth:{persistSession:false}});

export async function POST(req: Request) {
  const { userId } = await req.json();
  const { data: bp } = await admin.from("business_profiles").select("id").eq("user_id", userId).single();
  const profileId = bp!.id;

  const miss = await (await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/missing?userId=${userId}`)).json();
  if (miss.some((m:any)=>m.needed>0)) return NextResponse.json({ error:"missing_docs" }, { status: 400 });

  await admin.from("events").insert({ profile_id: profileId, type: "submit" });

  // tag en GHL (si tienes integrations/ghl_contact_id)
  const { data: integ } = await admin.from("integrations").select("ghl_contact_id").eq("profile_id", profileId).maybeSingle();
  if (integ?.ghl_contact_id) {
    fetch(`https://services.leadconnectorhq.com/contacts/${integ.ghl_contact_id}/tags`, {
      method:"POST",
      headers:{ Authorization:`Bearer ${process.env.GHL_TOKEN!}`, Version:"2021-07-28", "Content-Type":"application/json" },
      body: JSON.stringify({ tags: ["vault_submitted"] })
    }).catch(()=>{});
  }

  return NextResponse.json({ ok:true });
}
// Si hay error: { error:"missing_docs" } (400)
// Si todo ok: { ok:true }