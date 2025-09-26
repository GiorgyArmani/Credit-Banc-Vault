import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth:{persistSession:false} });
const BUCKET = "vault";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file") as File;            // <input name="file" />
  const userId = String(form.get("userId"));
  const profileId = String(form.get("profileId"));
  const docCode = String(form.get("docCode"));      // 'bank_stmt_6m' | 'dl_front_back' | 'void_check' | 'debt_schedule'
  const tags = (form.get("tags") ? JSON.parse(String(form.get("tags"))) : []) as string[];

  if (!file) return NextResponse.json({ error:"missing file" }, { status: 400 });

  const ext = file.name.split(".").pop();
  const filename = `${docCode}-${Date.now()}.${ext}`;
  const storage_path = `profile/${profileId}/${docCode}/${filename}`;

  // 1) subir al Storage
  const { error: upErr } = await admin.storage.from(BUCKET).upload(storage_path, await file.arrayBuffer(), { contentType: file.type, upsert:false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // 2) Insertar metadata + tags en user_documents
  const { data: inserted, error: insErr } = await admin.from("user_documents").insert({
    user_id: userId, name: file.name, normalized_name: filename,
    type: file.type, size: file.size, category: "vault",
    doc_code: docCode, storage_path, tags
  }).select("id").single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // 3) Evento + notificación (n8n)
  await admin.from("events").insert({ profile_id: profileId, type: "upload", payload: { doc_code: docCode, storage_path }, actor: userId });
  if (process.env.N8N_WEBHOOK_UPLOAD) {
    fetch(process.env.N8N_WEBHOOK_UPLOAD, {
      method:"POST", headers:{ "content-type":"application/json" },
      body: JSON.stringify({ profile_id: profileId, user_id: userId, doc_code: docCode })
    }).catch(()=>{});
  }

  // 4) (Opcional) aplicar tag en GHL al subir (para “doc X recibido”)
  //  - Busca contactId
  const { data: integ } = await admin.from("integrations").select("ghl_contact_id").eq("profile_id", profileId).maybeSingle();
  if (integ?.ghl_contact_id) {
    const prettyTag = `doc_${docCode}_uploaded`;
    fetch(`https://services.leadconnectorhq.com/contacts/${integ.ghl_contact_id}/tags`, {
      method: "POST",
      headers: { Authorization:`Bearer ${process.env.GHL_TOKEN!}`, Version:"2021-07-28", "Content-Type":"application/json" },
      body: JSON.stringify({ tags: [prettyTag] })
    }).catch(()=>{});
  }

  return NextResponse.json({ ok:true, documentId: inserted.id, storage_path });
}
