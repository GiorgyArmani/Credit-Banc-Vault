// app/dashboard/credit-report-assistant/page.tsx
'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { FileDown, Trash2, Eye, Loader2 } from 'lucide-react';
import Link from 'next/link';
import PDFViewer from '@/components/pdf/pdf-viewer';

// --- Types ---
type ReportRow = {
  id: string;
  title: string | null;
  full_name: string | null;
  report_date: string | null;
  report_pdf_url: string | null;
  created_at: string;
};

export default function CreditReportAssistantPage() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [title, setTitle] = useState<string>('Credit Report');

  // Progress / phases
  const [phase, setPhase] = useState<'idle' | 'queue' | 'analyze' | 'render' | 'upload' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);

  // Listado
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true); // ← evita mostrar “onboarding” antes de cargar

  // UI
  const [inlineViewUrl, setInlineViewUrl] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Eliminar dependencia de userId y cargar al montar
  useEffect(() => {
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Animate progress smoothly per phase
  useEffect(() => {
    if (!loading) return;
    const caps: Record<typeof phase, number> = {
      idle: 0,
      queue: 20,
      analyze: 55,
      render: 80,
      upload: 95,
      done: 100,
      error: 100,
    };
    const cap = caps[phase];
    const t = setInterval(() => setProgress((p) => (p < cap ? Math.min(p + 2, cap) : p)), 150);
    return () => clearInterval(t);
  }, [loading, phase]);

  async function refreshList() {
    try {
      setListLoading(true);
      const r = await fetch(`/api/reports`, { cache: 'no-store' }); // ← no-store para evitar flicker
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to load reports');
      setReports(j.items || []);
    } catch (e) {
      console.error(e);
    } finally {
      setListLoading(false);
      setFirstLoad(false); // ← ya terminó el primer fetch
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    setPhase('queue');
    setLoading(true);
    setProgress(5);
    setPdfUrl(null);
    setInlineViewUrl(null);

    try {
      setPhase('analyze');
      const res = await fetch('/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creditText: input, title: 'Credit Report' }), // ← sin userId
      });

      setPhase('render');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate report');

      setPhase('upload');
      setTitle(data.title || 'Credit Report');
      setPdfUrl(data.url);
      setInlineViewUrl(data.url);
      setInput('');

      await refreshList();
      setPhase('done');
      setProgress(100);
    } catch (err) {
      console.error(err);
      setPhase('error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this report?')) return;
    try {
      const r = await fetch(`/api/reports/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to delete');
      setReports((prev) => prev.filter((x) => x.id !== id));
      if (inlineViewUrl && reports.find((x) => x.id === id)?.report_pdf_url === inlineViewUrl) {
        setInlineViewUrl(null);
      }
    } catch (e: any) {
      alert(e.message || 'Delete failed');
    }
  }

  const steps = useMemo(
    () => [
      { key: 'queue', label: 'Queued' },
      { key: 'analyze', label: 'Analyzing' },
      { key: 'render', label: 'Building PDF' },
      { key: 'upload', label: 'Uploading' },
      { key: 'done', label: 'Ready' },
    ] as { key: typeof phase; label: string }[],
    [phase]
  );

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Credit Report Assistant</h1>
          <p className="text-sm text-muted-foreground mt-1">Paste a report → we analyze it and deliver an Insign PDF.</p>
        </div>
        <Link href="/dashboard">
          <Button variant="outline">← Back to Dashboard</Button>
        </Link>
      </div>

      {/* Composer */}
      <div className="rounded-2xl border bg-white/60 shadow-sm p-4 md:p-6 mb-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            rows={6}
            className="w-full p-3 rounded-lg border text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            placeholder="Paste your credit report here…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            
            <Button type="submit" className="min-w-[160px]" disabled={loading || !input.trim()}>
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating…
                </span>
              ) : (
                'Generate PDF'
              )}
            </Button>
          </div>
        </form>

        {/* Progress + steps */}
        {(loading || phase === 'done' || phase === 'error') && (
          <div className="mt-5 space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
              {steps.map((s) => {
                const idx = steps.findIndex((x) => x.key === phase);
                const me = steps.findIndex((x) => x.key === s.key);
                const active = me === idx;
                const done = me < idx || phase === 'done';
                return (
                  <span
                    key={s.key}
                    className={`px-2 py-0.5 rounded-full border ${
                      done
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : active
                        ? 'bg-gray-50 border-gray-300 text-gray-800'
                        : 'bg-white border-gray-200 text-gray-500'
                    }`}
                  >
                    {s.label}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Viewer */}
      {inlineViewUrl && (
        <div className="rounded-2xl border bg-white/60 shadow-sm p-3 md:p-5 mb-10">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{title}</h2>
              <p className="text-xs text-muted-foreground">Preview below. Use the toolbar to download or open in new tab.</p>
            </div>
          </div>
          <PDFViewer title={title} pdfUrl={inlineViewUrl} />
        </div>
      )}

      {/* History */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">My Reports</h3>
          <Button variant="outline" size="sm" onClick={refreshList} disabled={listLoading}>
            {listLoading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {!firstLoad && reports.length === 0 && ( // ← muestra el vacío sólo después de la primera carga
            <div className="col-span-full rounded-xl border p-6 text-sm text-muted-foreground">No reports yet.</div>
          )}

          {reports.map((r) => (
            <div key={r.id} className="rounded-xl border bg-white/60 shadow-sm p-4 flex flex-col">
              <div className="mb-2">
                <div className="font-medium text-sm">{r.title || 'Credit Report'}</div>
                <div className="text-xs text-muted-foreground">
                  {r.full_name ? `Client: ${r.full_name}` : ''}
                  {r.report_date ? ` • Date: ${r.report_date}` : ''}
                  {` • Created: ${new Date(r.created_at).toLocaleString()}`}
                </div>
              </div>
              <div className="mt-auto flex gap-2 flex-wrap">
                {r.report_pdf_url && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setInlineViewUrl(r.report_pdf_url!)}>
                      <Eye className="h-4 w-4 mr-1" /> View
                    </Button>
                    <Button size="sm" asChild className="bg-emerald-600 hover:bg-emerald-700 text-white">
                      <a href={r.report_pdf_url} target="_blank" rel="noopener noreferrer" download>
                        <FileDown className="h-4 w-4 mr-1" /> Download
                      </a>
                    </Button>
                  </>
                )}
                <Button size="sm" variant="destructive" onClick={() => handleDelete(r.id)} className="ml-auto">
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div ref={bottomRef} />
    </div>
  );
}
