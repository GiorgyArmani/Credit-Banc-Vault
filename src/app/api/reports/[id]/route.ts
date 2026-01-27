import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // obtener storage path a partir de la URL pública (si guardas storage_path, mejor)
    const { data: doc, error: readErr } = await supabase
      .from('credit_reports')
      .select('id, report_pdf_url, user_id')
      .eq('id', id)
      .single();

    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 404 });

    // Derivar storage path: reports/pdfs/<userId>/<filename>.pdf
    // Si quieres robustez extra, guarda 'storage_path' también en la tabla.
    let storagePath: string | null = null;
    try {
      const url = new URL(doc.report_pdf_url);
      const idx = url.pathname.indexOf('/object/public/reports/');
      if (idx !== -1) {
        storagePath = url.pathname.substring(idx + '/object/public/reports/'.length);
      }
    } catch { }

    if (storagePath) {
      const { error: rmErr } = await supabase.storage.from('reports').remove([storagePath]);
      if (rmErr && !/Not Found/i.test(rmErr.message)) {
        return NextResponse.json({ error: rmErr.message }, { status: 500 });
      }
    }

    const { error: delErr } = await supabase.from('credit_reports').delete().eq('id', id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
