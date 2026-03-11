"use client";

import LenderGuidelinesManager from "@/components/lender-guidelines-manager";

export default function LenderGuidelinesPage() {
  return (
    <div className="flex flex-col h-screen bg-[#0d1117]">
      {/* Header Bar */}
      <header className="flex-shrink-0 bg-[#161b22] border-b border-[#30363d] px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Lender Guidelines</h1>
          <p className="text-sm text-[#8b949e] mt-1">Manage lending criteria and database for the matching engine</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-3 py-1 bg-[#238636]/10 border border-[#238636]/20 rounded-full">
            <span className="text-[10px] font-bold text-[#238636] uppercase tracking-widest">Underwriting Panel</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden p-8 flex flex-col">
        <LenderGuidelinesManager />
      </main>

      {/* Styles for the editor and scrollbars */}
      <style jsx global>{`
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: #0d1117;
        }
        ::-webkit-scrollbar-thumb {
          background: #30363d;
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #484f58;
        }
      `}</style>
    </div>
  );
}
