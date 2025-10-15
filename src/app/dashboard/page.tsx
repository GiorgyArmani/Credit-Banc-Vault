'use client';
import AdvisorDisplay from "@/components/advisor-display";
import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import Vault from '@/components/vault';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Shield, Clock, UploadCloud } from 'lucide-react';

type ProfileRow = {
  business_name: string | null;
  industry: string | null;
  monthly_revenue: string | null;          // guardas string en tu esquema actual
  annual_revenue_last_year: string | null;
  business_model: string | null;           // aquí mapeamos “Entity”
  primary_goal: string | null;             // usamos para “Funding goal / Use of funds”
  // si tienes otras columnas (credit_score, start date, etc.) añádelas aquí:
  credit_score?: string | null;
  business_start_date?: string | null;
};

type IntegrationRow = {
  ghl_contact_id: string | null;
  advisor_name?: string | null; // si decides guardar advisor aquí
};

export default function DashboardPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [integration, setIntegration] = useState<IntegrationRow | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          // si deseas: redirigir a login
          setLoading(false);
          return;
        }
        setUserEmail(user.email ?? null);

        // 1) Hallar profile_id vía business_profiles (user_id = auth.uid)
        const { data: bp, error: bpErr } = await supabase
          .from('business_profiles')
          .select('id, business_name, industry, monthly_revenue, annual_revenue_last_year, business_model, primary_goal, credit_score, business_start_date')
          .eq('user_id', user.id)
          .maybeSingle();
        if (bpErr) throw bpErr;

        setProfile(bp ?? null);

        // 2) Integrations (usamos profile.id si existe)
        if (bp?.id) {
          const { data: ig, error: igErr } = await supabase
            .from('integrations')
            .select('ghl_contact_id, last_push_at, last_push_error, advisor_name') // advisor_name si decides guardarlo aquí
            .eq('profile_id', bp.id)
            .maybeSingle();
          if (igErr) throw igErr;
          setIntegration(ig ?? null);
        } else {
          setIntegration(null);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fields = useMemo(() => {
    return [
      { label: 'Funding goal', value: profile?.primary_goal || '—' },
      { label: 'Type of entity', value: profile?.business_model || '—' },
      { label: 'Industry', value: profile?.industry || '—' },
      { label: 'Business start date', value: profile?.business_start_date || '—' },
      { label: 'Monthly revenue', value: profile?.monthly_revenue || '—' },
      { label: 'Credit score', value: profile?.credit_score || '—' },
      { label: 'Your advisor is', value: integration?.advisor_name || '—' },
    ];
  }, [profile, integration]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 flex items-center justify-center">
              <UploadCloud className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">CreditBanc Vault</h1>
              <p className="text-xs text-slate-600">Easy • Fast • Secure</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200">BETA</Badge>
            <div className="hidden sm:flex items-center text-slate-600 text-sm gap-3">
              <span className="inline-flex items-center gap-1"><Shield className="h-4 w-4" /> Secure</span>
              <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" /> 24–48h underwriting</span>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Welcome */}
        <div>
          <h2 className="text-3xl font-bold text-slate-900 mb-1">Welcome{userEmail ? `, ${userEmail}` : ''}!</h2>
          <p className="text-slate-600">Upload your required documents and track your progress.</p>
        </div>

        {/* Profile Summary */}
        <AdvisorDisplay />
        <Card className="bg-white/90 border-slate-200">
          <CardHeader>
            <CardTitle className="text-slate-900">Your Profile</CardTitle>
            <CardDescription className="text-slate-600">
              Basic information used for your application
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-slate-500">Loading profile…</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {fields.map((f) => (
                  <div key={f.label} className="rounded-lg border p-3 bg-white">
                    <div className="text-xs uppercase tracking-wide text-slate-500">{f.label}</div>
                    <div className="text-slate-900 font-medium">{f.value}</div>
                  </div>
                ))}
              </div>
            )}
            {/* (Opcional) botón para editar perfil más adelante */}
            {/* <div className="mt-4">
              <Button variant="outline">Edit profile</Button>
            </div> */}
          </CardContent>
        </Card>

        {/* Vault */}
        <Card className="bg-white border-slate-200">
          <CardHeader className="pb-0">
            <CardTitle className="text-slate-900">Document Vault</CardTitle>
            <CardDescription className="text-slate-600">
              Upload your 6 months bank statements, ID (front & back), voided business check, and if applicable, a debt schedule.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <Vault />
          </CardContent>
        </Card>

        {/* Submit (opcional) 
            Puedes condicionar este botón leyendo el progreso desde el Vault vía props/recoil/context,
            o llamar a /api/submissions para “lock + submit”.
        */}
        {/* <div className="flex justify-end">
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
            Submit documents
          </Button>
        </div> */}
      </div>
    </div>
  );
}
