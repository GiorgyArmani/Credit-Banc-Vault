"use client";

import LenderGuidelinesManager from "@/components/lender-guidelines-manager";

export default function LenderGuidelinesPage() {
  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header Bar */}
      <header className="flex-shrink-0 bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Lender Guidelines</h1>
          <p className="text-sm text-slate-500 mt-1">Manage lending criteria and database for the matching engine</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-3 py-1 bg-emerald-50 border border-emerald-200 rounded-full">
            <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">Underwriting Panel</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden p-8 flex flex-col">
        <LenderGuidelinesManager />
      </main>

      {/* Light-theme scrollbar — matches the slate-on-white surfaces. */}
      <style jsx global>{`
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: #f1f5f9;
        }
        ::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </div>
  );
}
