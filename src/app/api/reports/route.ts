import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // Wrap de cookies para @supabase/ssr (getAll/setAll)
    const cookieStore = await cookies();
    const auth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // ignorar si corre en contexto sin mutación de cookies
            }
          },
        },
      }
    );

    // Usuario autenticado desde la sesión (cookies)
    const { data: { user }, error: authErr } = await auth.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Listar SOLO los reportes del usuario
    const { data, error } = await supabase
      .from('credit_reports')
      .select('id, title, full_name, report_date, report_pdf_url, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ items: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
