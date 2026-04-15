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

interface GroupedLender {
  name: string;
  programs: Lender[];
}

interface EditingGroup {
  lender_name: string;
  originalName: string;
  programs: Record<string, Partial<Lender>>; // specialty -> guidelines
  activeSpecialty: string;
}

const AVAILABLE_SPECIALTIES = [
  "MCA", "SBA", "LOC", "Equipment", "Amortizing", "Term Loan", "Real Estate", "Trucking", "Invoice Factoring", "Consolidation", "Reverse consolidation", "Contract Financing", "Acquisition", "General"
];

const INITIAL_LENDER_FIELDS: Omit<Lender, "id" | "lender_name" | "specialty"> = {
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
  const [editingGroup, setEditingGroup] = useState<EditingGroup | null>(null);
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

  const groupedLenders = useMemo(() => {
    const groups: Record<string, GroupedLender> = {};
    lenders.forEach(l => {
      if (!groups[l.lender_name]) {
        groups[l.lender_name] = { name: l.lender_name, programs: [] };
      }
      groups[l.lender_name].programs.push(l);
    });

    return Object.values(groups).filter(g =>
      g.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      g.programs.some(p => (p.specialty || "").toLowerCase().includes(searchTerm.toLowerCase()))
    ).sort((a, b) => a.name.localeCompare(b.name));
  }, [lenders, searchTerm]);

  function startEditing(group: GroupedLender) {
    const progMap: Record<string, Partial<Lender>> = {};
    group.programs.forEach(p => {
      progMap[p.specialty || "General"] = { ...p };
    });

    setEditingGroup({
      lender_name: group.name,
      originalName: group.name,
      programs: progMap,
      activeSpecialty: group.programs[0]?.specialty || "MCA",
    });
  }

  function startNew() {
    setEditingGroup({
      lender_name: "",
      originalName: "",
      programs: { "MCA": { lender_name: "", specialty: "MCA", ...INITIAL_LENDER_FIELDS } },
      activeSpecialty: "MCA",
    });
  }

  async function handleSave() {
    if (!editingGroup?.lender_name) {
      toast.error("Lender name is required");
      return;
    }
    setIsSaving(true);

    const dbPrograms = lenders.filter(l => l.lender_name === editingGroup.originalName);
    const newPrograms = Object.entries(editingGroup.programs);

    try {
      // 1. Handle Deletions (programs present in DB but not in editor)
      const toDelete = dbPrograms.filter(dbp => !editingGroup.programs[dbp.specialty || "General"]);
      for (const p of toDelete) {
        await supabase.from("lender_guidelines").delete().eq("id", p.id);
      }

      // 2. Handle Upserts (updates and inserts)
      for (const [spec, data] of newPrograms) {
        const { id, ...cleanData } = data;
        const payload = {
          ...cleanData,
          lender_name: editingGroup.lender_name,
          specialty: spec === "General" ? null : spec,
        };

        if (id) {
          await supabase.from("lender_guidelines").update(payload).eq("id", id);
        } else {
          await supabase.from("lender_guidelines").insert(payload);
        }
      }

      // 3. Handle Renames (Update remaining rows in DB if name changed)
      if (editingGroup.originalName && editingGroup.lender_name !== editingGroup.originalName) {
        await supabase.from("lender_guidelines")
          .update({ lender_name: editingGroup.lender_name })
          .eq("lender_name", editingGroup.originalName);
      }

      await fetchLenders();
      setEditingGroup(null);
      toast.success("All program guidelines saved");
    } catch (err) {
      console.error("Save error:", err);
      toast.error("Error saving guidelines");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteGroup(name: string) {
    if (!confirm(`Are you sure you want to remove ALL programs for ${name}?`)) return;
    const { error } = await supabase.from("lender_guidelines").delete().eq("lender_name", name);
    if (!error) {
      setLenders(prev => prev.filter(l => l.lender_name !== name));
      toast.success(`Removed ${name} from guidelines`);
    } else {
      toast.error("Error removing lender");
    }
  }

  const handleFieldChange = (field: keyof Lender, value: any) => {
    if (!editingGroup) return;
    const active = editingGroup.activeSpecialty;
    setEditingGroup({
      ...editingGroup,
      programs: {
        ...editingGroup.programs,
        [active]: { ...editingGroup.programs[active], [field]: value }
      }
    });
  };

  const handleNumberChange = (field: keyof Lender, value: string, isFloat = false) => {
    if (value === "") {
      handleFieldChange(field, null);
      return;
    }
    const num = isFloat ? parseFloat(value) : parseInt(value);
    handleFieldChange(field, isNaN(num) ? null : num);
  };

  const copyGuidelinesFrom = (sourceSpec: string) => {
    if (!editingGroup || !sourceSpec) return;
    const sourceData = editingGroup.programs[sourceSpec];
    if (!sourceData) return;

    // Copy all fields except ID and Specialty
    const currentActive = editingGroup.activeSpecialty;
    const { id, specialty, lender_name, ...fieldsToCopy } = sourceData;

    setEditingGroup({
      ...editingGroup,
      programs: {
        ...editingGroup.programs,
        [currentActive]: {
          ...editingGroup.programs[currentActive],
          ...fieldsToCopy
        }
      }
    });
    toast.success(`Guidelines copied from ${sourceSpec}`);
  };

  const toggleSpecialty = (spec: string) => {
    if (!editingGroup) return;
    const next = { ...editingGroup.programs };
    if (next[spec]) {
      if (Object.keys(next).length > 1) {
        delete next[spec];
        const remaining = Object.keys(next);
        setEditingGroup({
          ...editingGroup,
          programs: next,
          activeSpecialty: remaining.includes(editingGroup.activeSpecialty) ? editingGroup.activeSpecialty : remaining[0]
        });
      } else {
        toast.error("At least one program is required");
      }
    } else {
      // Copy current guidelines to new program to speed up setup
      const currentData = editingGroup.programs[editingGroup.activeSpecialty] || INITIAL_LENDER_FIELDS;
      next[spec] = { ...currentData, id: undefined, specialty: spec, lender_name: editingGroup.lender_name };
      setEditingGroup({ ...editingGroup, programs: next, activeSpecialty: spec });
    }
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
          onClick={startNew}
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
          ) : groupedLenders.length === 0 ? (
            <div className="col-span-full py-12 text-center text-[#8b949e] border border-dashed border-[#30363d] rounded-xl">No lenders found.</div>
          ) : (
            groupedLenders.map(group => (
              <div
                key={group.name}
                className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 flex flex-col justify-between hover:border-[#8b949e] transition-all group"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-white font-semibold truncate" title={group.name}>{group.name}</h3>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {group.programs.map(p => (
                          <span key={p.id} className="text-[10px] font-mono text-[#58a6ff] bg-[#58a6ff]/10 border border-[#58a6ff]/20 px-1.5 py-0.5 rounded">
                            {p.specialty || "General"}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                      <button onClick={() => startEditing(group)} className="p-1.5 text-[#8b949e] hover:text-[#58a6ff] transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5M16.242 5.242a2.828 2.828 0 114 4L11.828 15.172a4 4 0 01-1.414.942l-2.829.942.942-2.828a4 4 0 01.942-1.414l7.409-7.409z" /></svg>
                      </button>
                      <button onClick={() => handleDeleteGroup(group.name)} className="p-1.5 text-[#8b949e] hover:text-[#f85149] transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>

                  {/* Summary of first program or combined summary */}
                  <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-[#8b949e] font-mono">
                    <div className="flex justify-between border-b border-[#30363d] pb-1">
                      <span>Programs</span>
                      <span className="text-[#c9d1d9]">{group.programs.length}</span>
                    </div>
                    <div className="flex justify-between border-b border-[#30363d] pb-1">
                      <span>Primary Specialty</span>
                      <span className="text-[#58a6ff]">{group.programs[0]?.specialty || "—"}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Editor Modal */}
      {editingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-4 border-b border-[#30363d] flex items-center justify-between bg-[#0d1117]">
              <div>
                <h2 className="text-xl font-bold text-white">
                  {editingGroup.originalName ? `Manage ${editingGroup.originalName}` : "New Lender Profile"}
                </h2>
                <p className="text-xs text-[#8b949e] mt-1">Configure criteria for multiple programs</p>
              </div>
              <button
                onClick={() => setEditingGroup(null)}
                className="p-2 text-[#8b949e] hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Sidebar/Top Section: Name and Specialty Selection */}
              <div className="p-6 bg-[#0d1117] border-b border-[#30363d] space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Lender Name</label>
                    <input
                      type="text"
                      value={editingGroup.lender_name}
                      onChange={e => setEditingGroup({ ...editingGroup, lender_name: e.target.value })}
                      className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Programs / Specialties (Select multiple)</label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {AVAILABLE_SPECIALTIES.map(spec => (
                        <button
                          key={spec}
                          onClick={() => toggleSpecialty(spec)}
                          className={`px-2 py-1 text-[10px] font-mono rounded border transition-all ${editingGroup.programs[spec]
                              ? "bg-[#58a6ff] border-[#58a6ff] text-white"
                              : "bg-[#161b22] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]"
                            }`}
                        >
                          {spec}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Program Tabs and Actions */}
                <div className="flex items-center justify-between border-b border-[#30363d]">
                  <div className="flex items-center gap-2">
                    {Object.keys(editingGroup.programs).map(spec => (
                      <button
                        key={spec}
                        onClick={() => setEditingGroup({ ...editingGroup, activeSpecialty: spec })}
                        className={`px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all border-b-2 ${editingGroup.activeSpecialty === spec
                            ? "border-[#58a6ff] text-[#58a6ff]"
                            : "border-transparent text-[#8b949e] hover:text-white"
                          }`}
                      >
                        {spec}
                      </button>
                    ))}
                  </div>

                  {/* Copy Action */}
                  {Object.keys(editingGroup.programs).length > 1 && (
                    <div className="flex items-center gap-2 px-4 py-1">
                      <select
                        onChange={(e) => copyGuidelinesFrom(e.target.value)}
                        className="bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-[10px] text-[#8b949e] outline-none hover:border-[#58a6ff] transition-all"
                        value=""
                      >
                        <option value="" disabled>Copy guidelines from...</option>
                        {Object.keys(editingGroup.programs)
                          .filter(s => s !== editingGroup.activeSpecialty)
                          .map(s => <option key={s} value={s}>{s}</option>)
                        }
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Guidelines Form for Active Specialty */}
              <div className="p-6 space-y-8">
                {editingGroup.programs[editingGroup.activeSpecialty] ? (
                  <>
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-[#58a6ff] uppercase tracking-widest">
                          {editingGroup.activeSpecialty} Qualification Thresholds
                        </h3>
                        {Object.keys(editingGroup.programs).length > 1 && (
                          <span className="text-[10px] text-[#8b949e] font-mono italic">Settings apply only to this tab</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Min FICO</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].min_fico ?? ""}
                            onChange={e => handleNumberChange("min_fico", e.target.value)}
                            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Min SBSS</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].min_sbss ?? ""}
                            onChange={e => handleNumberChange("min_sbss", e.target.value)}
                            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Min TIB (Mo)</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].time_in_business_months ?? ""}
                            onChange={e => handleNumberChange("time_in_business_months", e.target.value)}
                            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Min Revenue</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].avg_monthly_revenue ?? ""}
                            onChange={e => handleNumberChange("avg_monthly_revenue", e.target.value, true)}
                            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Avg Daily Bal</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].avg_daily_balance ?? ""}
                            onChange={e => handleNumberChange("avg_daily_balance", e.target.value, true)}
                            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Max Neg Days</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].negative_days ?? ""}
                            onChange={e => handleNumberChange("negative_days", e.target.value)}
                            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Min Deposits</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].monthly_deposits ?? ""}
                            onChange={e => handleNumberChange("monthly_deposits", e.target.value)}
                            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Max Positions</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].number_of_positions ?? ""}
                            onChange={e => handleNumberChange("number_of_positions", e.target.value)}
                            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Min Funding</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].min_funding ?? ""}
                            onChange={e => handleNumberChange("min_funding", e.target.value, true)}
                            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Max Funding</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].max_funding ?? ""}
                            onChange={e => handleNumberChange("max_funding", e.target.value, true)}
                            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Consol. Positions</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].consolidation_positions ?? ""}
                            onChange={e => handleNumberChange("consolidation_positions", e.target.value)}
                            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Min Ownership %</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].ownership_percentage ?? ""}
                            onChange={e => handleNumberChange("ownership_percentage", e.target.value, true)}
                            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Tax Liens Limit</label>
                          <input
                            type="text"
                            value={editingGroup.programs[editingGroup.activeSpecialty].tax_liens_limit ?? ""}
                            onChange={e => handleFieldChange("tax_liens_limit", e.target.value)}
                            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Holdback %</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].holdback_percentage ?? ""}
                            onChange={e => handleNumberChange("holdback_percentage", e.target.value, true)}
                            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                          />
                        </div>
                      </div>
                    </section>

                    <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Restricted States</label>
                        <input
                          type="text"
                          value={editingGroup.programs[editingGroup.activeSpecialty].restricted_states || ""}
                          onChange={e => handleFieldChange("restricted_states", e.target.value.toUpperCase())}
                          placeholder="e.g. CA, NY, PR"
                          className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Payment Type</label>
                        <input
                          type="text"
                          value={editingGroup.programs[editingGroup.activeSpecialty].payment_type || ""}
                          onChange={e => handleFieldChange("payment_type", e.target.value)}
                          placeholder="e.g. Daily ACH, Weekly"
                          className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff]"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Preferred Industries</label>
                        <textarea
                          value={editingGroup.programs[editingGroup.activeSpecialty].preferred_industries || ""}
                          onChange={e => handleFieldChange("preferred_industries", e.target.value)}
                          rows={2}
                          className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff] resize-none"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Restricted Industries</label>
                        <textarea
                          value={editingGroup.programs[editingGroup.activeSpecialty].restricted_industries || ""}
                          onChange={e => handleFieldChange("restricted_industries", e.target.value)}
                          rows={2}
                          className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff] resize-none"
                        />
                      </div>
                    </section>

                    <section>
                      <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Additional Information / Internal Notes</label>
                      <textarea
                        value={editingGroup.programs[editingGroup.activeSpecialty].additional_info || ""}
                        onChange={e => handleFieldChange("additional_info", e.target.value)}
                        rows={4}
                        className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58a6ff] resize-none"
                      />
                    </section>
                  </>
                ) : (
                  <div className="py-20 text-center">
                    <p className="text-[#8b949e] font-mono">No active program selected.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-[#30363d] bg-[#0d1117] flex justify-end gap-3">
              <button
                onClick={() => setEditingGroup(null)}
                className="px-4 py-2 text-sm font-medium text-[#c9d1d9] hover:text-white transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-6 py-2 bg-[#238636] hover:bg-[#2ea043] text-white text-sm font-semibold rounded-lg shadow-lg disabled:opacity-50 transition-all uppercase tracking-wider"
              >
                {isSaving ? "Saving..." : "Save All Programs"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
