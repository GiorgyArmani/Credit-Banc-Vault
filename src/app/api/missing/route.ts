import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth:{persistSession:false}});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId")!;
  const { data: bp } = await admin.from("business_profiles").select("id").eq("user_id", userId).single();
  const profileId = bp!.id;

  const { data: overrides } = await admin.from("events").select("payload").eq("profile_id", profileId).eq("type","rule_override");
  const requireDebt = overrides?.some(o => o.payload?.require_debt_schedule) ?? false;

  const rules = [
    { code:"bank_stmt_6m",  label:"Bank Statements (6 months)", min:6, required:true },
    { code:"dl_front_back", label:"Driver’s License (front & back)", min:2, required:true },
    { code:"void_check",    label:"Voided Business Check",        min:1, required:true },
    { code:"debt_schedule", label:"Business Debt Schedule",       min:1, required:requireDebt }
  ].filter(r => r.required);

  const { data: docs } = await admin.from("user_documents").select("doc_code").eq("user_id", userId);
  const counts: Record<string, number> = {};
  (docs||[]).forEach(d => counts[d.doc_code] = (counts[d.doc_code]||0)+1);

  const missing = rules.map(r => ({ code:r.code, label:r.label, needed: Math.max(0, r.min - (counts[r.code]||0)) }));
  return NextResponse.json(missing);
}
// Si todo ok, needed=0; si falta, needed>0
// Ejemplo response: [ { code:"bank_stmt_6m", label:"Bank Statements (6 months)", needed:2 }, { code:"dl_front_back", label:"Driver’s License (front & back)", needed:0 }, ... ]