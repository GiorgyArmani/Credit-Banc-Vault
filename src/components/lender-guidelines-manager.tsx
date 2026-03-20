"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

interface Lender {
  id: string;
  lender_name: string;
  specialty: string | null;
  min_fico: number | null;
  min_sbss: number | null;
  time_in_business_months: number | null;
  negative_days: number | null;
  monthly_deposits: number | null;
  avg_monthly_revenue: number | null;
  avg_daily_balance: number | null;
  preferred_industries: string | null;
  restricted_industries: string | null;
  restricted_industry_exceptions: string | null;
  restricted_states: string | null;
  ownership_percentage: number | null;
  number_of_positions: number | null;
  bankruptcies: string | null;
  tax_liens_limit: number | string | null;
  min_funding: number | string | null;
  max_funding: number | string | null;
  auto_decline_reasons: string | null;
  holdback_percentage: number | null;
  payment_type: string | null;
  consolidation_positions: number | null;
  additional_info: string | null;
}

const INITIAL_LENDER: Partial<Lender> = {
  lender_name: "",
  specialty: "MCA",
  min_fico: 0,
  min_sbss: 0,
  time_in_business_months: 0,
  negative_days: 0,
  monthly_deposits: 0,
  avg_monthly_revenue: 0,
  avg_daily_balance: 0,
  preferred_industries: "",
  restricted_industries: "",
  restricted_industry_exceptions: "",
  restricted_states: "",
  ownership_percentage: 0,
  number_of_positions: 0,
  bankruptcies: "",
  tax_liens_limit: "",
  min_funding: 0,
  max_funding: 0,
  auto_decline_reasons: "",
  holdback_percentage: 0,
  payment_type: "",
  consolidation_positions: 0,
  additional_info: "",
};

export default function LenderGuidelinesManager() {
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingLender, setEditingLender] = useState<Partial<Lender> | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    fetchLenders();
  }, []);

  async function fetchLenders() {
    setLoading(true);
    const { data, error } = await supabase
      .from("lender_guidelines")
      .select("*")
      .order("lender_name", { ascending: true });
    
    if (data) setLenders(data);
    setLoading(false);
  }

  const filteredLenders = useMemo(() => {
    return lenders.filter(l => 
      l.lender_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (l.specialty || "").toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [lenders, searchTerm]);

  async function handleSave() {
    if (!editingLender?.lender_name) {
      toast.error("Lender name is required");
      return;
    }
    setIsSaving(true);

    const { id, ...data } = editingLender;

    // Filter to only include valid DB columns, skipping system fields or UI-only fields
    const payload = {
      lender_name: data.lender_name,
      specialty: data.specialty,
      min_fico: data.min_fico,
      min_sbss: data.min_sbss,
      time_in_business_months: data.time_in_business_months,
      negative_days: data.negative_days,
      monthly_deposits: data.monthly_deposits,
      avg_monthly_revenue: data.avg_monthly_revenue,
      avg_daily_balance: data.avg_daily_balance,
      preferred_industries: data.preferred_industries,
      restricted_industries: data.restricted_industries,
      restricted_industry_exceptions: data.restricted_industry_exceptions,
      restricted_states: data.restricted_states,
      ownership_percentage: data.ownership_percentage,
      number_of_positions: data.number_of_positions,
      bankruptcies: data.bankruptcies,
      tax_liens_limit: data.tax_liens_limit,
      min_funding: data.min_funding,
      max_funding: data.max_funding,
      auto_decline_reasons: data.auto_decline_reasons,
      holdback_percentage: data.holdback_percentage,
      payment_type: data.payment_type,
      consolidation_positions: data.consolidation_positions,
      additional_info: data.additional_info,
    };
    
    if (id) {
      // Update
      const { data: updated, error } = await supabase
        .from("lender_guidelines")
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (!error && updated) {
        setLenders(prev => prev.map(l => l.id === id ? { ...l, ...payload, id } as Lender : l));
        setEditingLender(null);
        toast.success("Guidelines updated successfully");
      } else {
        console.error("Error updating lender:", error);
        if (!error && !updated) {
           toast.error("No rows were updated. Check your permissions (RLS policies).");
        } else {
           toast.error(`Error saving: ${error?.message || "Unknown error"}`);
        }
      }
    } else {
      // Insert
      const { data: inserted, error } = await supabase
        .from("lender_guidelines")
        .insert(payload)
        .select()
        .single();
      if (!error && inserted) {
        setLenders(prev => [...prev, inserted].sort((a, b) => a.lender_name.localeCompare(b.lender_name)));
        setEditingLender(null);
        toast.success("New lender guidelines added");
      } else {
        console.error("Error inserting lender:", error);
        toast.error(`Error saving: ${error?.message || "Unknown error"}`);
      }
    }
    setIsSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to remove this lender?")) return;
    const { error } = await supabase.from("lender_guidelines").delete().eq("id", id);
    if (!error) {
      setLenders(prev => prev.filter(l => l.id !== id));
      toast.success("Lender guidelines removed");
    } else {
      toast.error(`Error deleting: ${error?.message || "Unknown error"}`);
    }
  }

  const handleNumberChange = (field: keyof Lender, value: string, isFloat = false) => {
    if (value === "") {
      setEditingLender(prev => prev ? ({ ...prev, [field]: null }) : null);
      return;
    }
    const num = isFloat ? parseFloat(value) : parseInt(value);
    setEditingLender(prev => prev ? ({ ...prev, [field]: isNaN(num) ? null : num }) : null);
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder="Search lenders..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-2 text-sm text-[#c9d1d9] focus:outline-none focus:border-[#58a6ff] transition-all"
          />
        </div>
        <button
          onClick={() => setEditingLender(INITIAL_LENDER)}
          className="px-4 py-2 bg-[#238636] hover:bg-[#2ea043] text-white text-sm font-medium rounded-lg transition-all uppercase tracking-wider"
        >
          Add Lender
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-8">
          {loading ? (
             <div className="col-span-full py-12 text-center text-[#8b949e] animate-pulse font-mono">Loading Guidelines...</div>
          ) : filteredLenders.length === 0 ? (
             <div className="col-span-full py-12 text-center text-[#8b949e] border border-dashed border-[#30363d] rounded-xl">No lenders found.</div>
          ) : (
            filteredLenders.map(lender => (
              <div 
                key={lender.id}
                className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 flex flex-col justify-between hover:border-[#8b949e] transition-all group"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-white font-semibold">{lender.lender_name}</h3>
                      <span className="text-xs font-mono text-[#58a6ff] bg-[#58a6ff]/10 border border-[#58a6ff]/20 px-1.5 py-0.5 rounded mt-1 inline-block">
                        {lender.specialty || "General"}
                      </span>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                       <button onClick={() => setEditingLender(lender)} className="p-1.5 text-[#8b949e] hover:text-[#58a6ff] transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5M16.242 5.242a2.828 2.828 0 114 4L11.828 15.172a4 4 0 01-1.414.942l-2.829.942.942-2.828a4 4 0 01.942-1.414l7.409-7.409z" /></svg>
                       </button>
                       <button onClick={() => handleDelete(lender.id)} className="p-1.5 text-[#8b949e] hover:text-[#f85149] transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                       </button>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-[#8b949e] font-mono">
                    <div className="flex justify-between border-b border-[#30363d] pb-1">
                      <span>Min FICO</span>
                      <span className="text-[#c9d1d9]">{lender.min_fico || "—"}</span>
                    </div>
                    <div className="flex justify-between border-b border-[#30363d] pb-1">
                      <span>Min TIB</span>
                      <span className="text-[#c9d1d9]">{lender.time_in_business_months}mo</span>
                    </div>
                    <div className="flex justify-between border-b border-[#30363d] pb-1">
                      <span>Min Rev</span>
                      <span className="text-[#c9d1d9]">${((lender.avg_monthly_revenue || 0)/1000).toFixed(0)}k</span>
                    </div>
                    <div className="flex justify-between border-b border-[#30363d] pb-1">
                      <span>Max Neg</span>
                      <span className="text-[#c9d1d9]">{lender.negative_days ?? "—"}</span>
                    </div>
                    <div className="flex justify-between border-b border-[#30363d] pb-1">
                      <span>SBSS</span>
                      <span className="text-[#c9d1d9]">{lender.min_sbss || "—"}</span>
                    </div>
                    <div className="flex justify-between border-b border-[#30363d] pb-1">
                      <span>Min Dep</span>
                      <span className="text-[#c9d1d9]">${((lender.monthly_deposits || 0)/1000).toFixed(0)}k</span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Editor Modal */}
      {editingLender && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-4 border-b border-[#30363d] flex items-center justify-between bg-[#0d1117]">
              <div>
                <h2 className="text-xl font-bold text-white">
                  {editingLender.id ? "Edit Lender Guidelines" : "New Lender Profile"}
                </h2>
                <p className="text-xs text-[#8b949e] mt-1">Configure criteria for the matching engine</p>
              </div>
              <button 
                onClick={() => setEditingLender(null)}
                className="p-2 text-[#8b949e] hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Basic Info */}
              <section>
                <h3 className="text-sm font-bold text-[#58a6ff] uppercase tracking-widest mb-4">Basic Profile</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Lender Name</label>
                    <input 
                      type="text"
                      value={editingLender.lender_name}
                      onChange={e => setEditingLender({...editingLender, lender_name: e.target.value})}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Specialty / Program</label>
                    <input 
                      type="text"
                      value={editingLender.specialty || ""}
                      onChange={e => setEditingLender({...editingLender, specialty: e.target.value})}
                      placeholder="e.g. MCA, SBA, Equipment"
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                </div>
              </section>

              {/* Hard Constraints */}
              <section>
                <h3 className="text-sm font-bold text-[#58a6ff] uppercase tracking-widest mb-4">Qualification Thresholds</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Min FICO</label>
                    <input 
                      type="number"
                      value={editingLender.min_fico ?? ""}
                      onChange={e => handleNumberChange("min_fico", e.target.value)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Min SBSS</label>
                    <input 
                      type="number"
                      value={editingLender.min_sbss ?? ""}
                      onChange={e => handleNumberChange("min_sbss", e.target.value)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Min TIB (Mo)</label>
                    <input 
                      type="number"
                      value={editingLender.time_in_business_months ?? ""}
                      onChange={e => handleNumberChange("time_in_business_months", e.target.value)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Min Revenue</label>
                    <input 
                      type="number"
                      value={editingLender.avg_monthly_revenue ?? ""}
                      onChange={e => handleNumberChange("avg_monthly_revenue", e.target.value, true)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Avg Daily Bal</label>
                    <input 
                      type="number"
                      value={editingLender.avg_daily_balance ?? ""}
                      onChange={e => handleNumberChange("avg_daily_balance", e.target.value, true)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Max Neg Days</label>
                    <input 
                      type="number"
                      value={editingLender.negative_days ?? ""}
                      onChange={e => handleNumberChange("negative_days", e.target.value)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Min Deposits</label>
                    <input 
                      type="number"
                      value={editingLender.monthly_deposits ?? ""}
                      onChange={e => handleNumberChange("monthly_deposits", e.target.value)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Max Positions</label>
                    <input 
                      type="number"
                      value={editingLender.number_of_positions ?? ""}
                      onChange={e => handleNumberChange("number_of_positions", e.target.value)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Min Funding</label>
                    <input 
                      type="number"
                      value={editingLender.min_funding ?? ""}
                      onChange={e => handleNumberChange("min_funding", e.target.value, true)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Max Funding</label>
                    <input 
                      type="number"
                      value={editingLender.max_funding ?? ""}
                      onChange={e => handleNumberChange("max_funding", e.target.value, true)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Consol. Positions</label>
                    <input 
                      type="number"
                      value={editingLender.consolidation_positions ?? ""}
                      onChange={e => handleNumberChange("consolidation_positions", e.target.value)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Min Ownership %</label>
                    <input 
                      type="number"
                      value={editingLender.ownership_percentage ?? ""}
                      onChange={e => handleNumberChange("ownership_percentage", e.target.value, true)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Tax Liens Limit</label>
                    <input 
                      type="text"
                      value={editingLender.tax_liens_limit ?? ""}
                      onChange={e => setEditingLender({...editingLender, tax_liens_limit: e.target.value})}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Holdback %</label>
                    <input 
                      type="number"
                      value={editingLender.holdback_percentage ?? ""}
                      onChange={e => handleNumberChange("holdback_percentage", e.target.value, true)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                </div>
              </section>

              {/* Geo & Industry */}
              <section>
                <h3 className="text-sm font-bold text-[#58a6ff] uppercase tracking-widest mb-4">Geographic & Industry Filters</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5 drop-shadow-sm">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Restricted States (Comma separated)</label>
                    <input 
                      type="text"
                      value={editingLender.restricted_states || ""}
                      onChange={e => setEditingLender({...editingLender, restricted_states: e.target.value.toUpperCase()})}
                      placeholder="e.g. CA, NY, PR"
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Preferred Industries</label>
                    <textarea 
                      value={editingLender.preferred_industries || ""}
                      onChange={e => setEditingLender({...editingLender, preferred_industries: e.target.value})}
                      rows={2}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff] resize-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Restricted Ind (Comma separated)</label>
                    <textarea 
                      value={editingLender.restricted_industries || ""}
                      onChange={e => setEditingLender({...editingLender, restricted_industries: e.target.value})}
                      rows={2}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff] resize-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Industry Exceptions</label>
                    <textarea 
                      value={editingLender.restricted_industry_exceptions || ""}
                      onChange={e => setEditingLender({...editingLender, restricted_industry_exceptions: e.target.value})}
                      rows={2}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff] resize-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Bankruptcies (Criteria)</label>
                    <input 
                      type="text"
                      value={editingLender.bankruptcies || ""}
                      onChange={e => setEditingLender({...editingLender, bankruptcies: e.target.value})}
                      placeholder="e.g. 3 years since discharge"
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Payment Type</label>
                    <input 
                      type="text"
                      value={editingLender.payment_type || ""}
                      onChange={e => setEditingLender({...editingLender, payment_type: e.target.value})}
                      placeholder="e.g. Daily ACH, Weekly"
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Auto-Decline Reasons</label>
                    <textarea 
                      value={editingLender.auto_decline_reasons || ""}
                      onChange={e => setEditingLender({...editingLender, auto_decline_reasons: e.target.value})}
                      rows={2}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff] resize-none"
                    />
                  </div>
                </div>
              </section>

              {/* Additional Notes */}
              <section>
                <h3 className="text-sm font-bold text-[#58a6ff] uppercase tracking-widest mb-4">Program Details & Notes</h3>
                <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Additional Information / Internal Notes</label>
                    <textarea 
                      value={editingLender.additional_info || ""}
                      onChange={e => setEditingLender({...editingLender, additional_info: e.target.value})}
                      rows={4}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff] resize-none"
                    />
                </div>
              </section>
            </div>

            <div className="p-4 border-t border-[#30363d] bg-[#0d1117] flex justify-end gap-3">
              <button 
                onClick={() => setEditingLender(null)}
                className="px-4 py-2 text-sm font-medium text-[#c9d1d9] hover:text-white transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={handleSave}
                disabled={isSaving}
                className="px-6 py-2 bg-[#238636] hover:bg-[#2ea043] text-white text-sm font-semibold rounded-lg shadow-lg disabled:opacity-50 transition-all uppercase tracking-wider"
              >
                {isSaving ? "Saving..." : "Save Guidelines"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
