"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, X, Building2, DollarSign, AlertTriangle, FileCheck2, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { createClient } from "@/lib/supabase/client";
import { CLIENT_SCOPED_DOC_CODES } from "@/lib/document-scope";
import { FUNDING_OPTIONS } from "@/data/loan-types";

interface AddBusinessModalProps {
  client_vault_id: string;
  open: boolean;
  on_close: () => void;
  on_created: (business: any) => void;
}

interface OpenPosition {
  lender_name: string;
  loan_type: string;
  initial_balance: string;
  current_balance: string;
  payment_amount: string;
  payment_frequency: string;
  term_remaining: string;
}

interface DocOption {
  code: string;
  label: string;
  is_core: boolean;
}

const LEGAL_ENTITY_TYPES = ["LLC", "C-Corp", "S-Corp", "Sole Prop", "Partnership", "Other"];
const FUNDING_ETAS = ["Immediately", "1–3 Weeks", "3 Weeks +"];
const PAYMENT_FREQUENCIES = ["Daily", "Weekly", "Bi-Weekly", "Monthly"] as const;

export function AddBusinessModal({ client_vault_id, open, on_close, on_created }: AddBusinessModalProps) {
  // Business info
  const [company_name, set_company_name] = useState("");
  const [legal_entity_type, set_legal_entity_type] = useState("");
  const [business_start_date, set_business_start_date] = useState("");
  const [industry, set_industry] = useState("");
  const [is_home_based, set_is_home_based] = useState(false);
  const [company_city, set_company_city] = useState("");
  const [company_state, set_company_state] = useState("");
  const [company_zip_code, set_company_zip_code] = useState("");
  const [employees_count, set_employees_count] = useState("");
  const [phone, set_phone] = useState("");

  // Financials
  const [avg_monthly_deposits, set_avg_monthly_deposits] = useState("");
  const [avg_annual_revenue, set_avg_annual_revenue] = useState("");

  // Funding ask
  const [capital_requested, set_capital_requested] = useState("");
  const [proposed_loan_types, set_proposed_loan_types] = useState<string[]>([]);
  const [loan_purpose, set_loan_purpose] = useState("");
  const [funding_eta, set_funding_eta] = useState("");

  const toggle_loan_type = (type: string) => {
    set_proposed_loan_types((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  // Open positions
  const [open_positions, set_open_positions] = useState<OpenPosition[]>([]);

  // Doc requests
  const [all_doc_options, set_all_doc_options] = useState<DocOption[]>([]);
  const [requested_doc_codes, set_requested_doc_codes] = useState<Set<string>>(new Set());

  const [is_submitting, set_is_submitting] = useState(false);

  // Load available doc types once. Personal-identity docs (driver's license,
  // MyScoreIQ, PFS) are filtered out: they describe the client and are
  // already collected via the primary business at signup, so requesting them
  // again per business would create duplicate work and double-count progress.
  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("required_documents")
        .select("code, label, is_core")
        .order("is_core", { ascending: false })
        .order("label", { ascending: true });
      const items = ((data || []) as DocOption[]).filter(
        (d) => !CLIENT_SCOPED_DOC_CODES.includes(d.code as any)
      );
      set_all_doc_options(items);
      // Default-select the core docs so the advisor always requests the basics.
      set_requested_doc_codes(new Set(items.filter((d) => d.is_core).map((d) => d.code)));
    })();
  }, [open]);

  if (!open) return null;

  const reset = () => {
    set_company_name("");
    set_legal_entity_type("");
    set_business_start_date("");
    set_industry("");
    set_is_home_based(false);
    set_company_city("");
    set_company_state("");
    set_company_zip_code("");
    set_employees_count("");
    set_phone("");
    set_avg_monthly_deposits("");
    set_avg_annual_revenue("");
    set_capital_requested("");
    set_proposed_loan_types([]);
    set_loan_purpose("");
    set_funding_eta("");
    set_open_positions([]);
    set_requested_doc_codes(new Set(all_doc_options.filter((d) => d.is_core).map((d) => d.code)));
  };

  const close = () => {
    if (is_submitting) return;
    reset();
    on_close();
  };

  const add_position = () => {
    if (open_positions.length >= 5) return;
    set_open_positions((prev) => [
      ...prev,
      {
        lender_name: "",
        loan_type: "",
        initial_balance: "",
        current_balance: "",
        payment_amount: "",
        payment_frequency: "",
        term_remaining: "",
      },
    ]);
  };

  const update_position = (idx: number, patch: Partial<OpenPosition>) => {
    set_open_positions((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const remove_position = (idx: number) => {
    set_open_positions((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggle_doc = (code: string) => {
    set_requested_doc_codes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const submit = async () => {
    if (!company_name.trim()) {
      toast.error("Company name is required");
      return;
    }
    set_is_submitting(true);
    try {
      const res = await fetch(`/api/advisor/clients/${client_vault_id}/businesses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: company_name.trim(),
          legal_entity_type: legal_entity_type || null,
          business_start_date: business_start_date || null,
          industry: industry || null,
          is_home_based,
          company_city: company_city || null,
          company_state: company_state || null,
          company_zip_code: company_zip_code || null,
          employees_count: employees_count || null,
          phone: phone || null,
          avg_monthly_deposits: avg_monthly_deposits || null,
          avg_annual_revenue: avg_annual_revenue || null,
          capital_requested: capital_requested || null,
          // Multi-select: serialize to a comma-separated string to match how
          // the signup form and edit-profile modal persist this field.
          proposed_loan_type: proposed_loan_types.length > 0 ? proposed_loan_types.join(", ") : null,
          loan_purpose: loan_purpose || null,
          funding_eta: funding_eta || null,
          open_positions: open_positions
            .filter((p) => p.lender_name.trim() && p.loan_type.trim())
            .map((p) => ({
              lender_name: p.lender_name.trim(),
              loan_type: p.loan_type.trim(),
              initial_balance: p.initial_balance || null,
              current_balance: p.current_balance || null,
              payment_amount: p.payment_amount || null,
              payment_frequency: PAYMENT_FREQUENCIES.includes(p.payment_frequency as any)
                ? p.payment_frequency
                : null,
              term_remaining: p.term_remaining || null,
            })),
          requested_doc_codes: Array.from(requested_doc_codes),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create business");
      toast.success(`${company_name} added with ${requested_doc_codes.size} doc request(s)`);
      on_created(json.business);
      reset();
      on_close();
    } catch (e: any) {
      toast.error(e.message || "Could not create business");
    } finally {
      set_is_submitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <Plus className="h-5 w-5 text-emerald-700" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Add Another Business</h3>
              <p className="text-xs text-slate-500">Creates a fully-scoped vault for this client's additional business</p>
            </div>
          </div>
          <button
            onClick={close}
            disabled={is_submitting}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* SECTION 1 — Business info */}
          <Section icon={<Building2 className="h-4 w-4" />} title="Business Information">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Company Name" required>
                <input
                  type="text"
                  value={company_name}
                  onChange={(e) => set_company_name(e.target.value)}
                  className={input_cls}
                  placeholder="Acme Logistics LLC"
                />
              </Field>
              <Field label="Legal Entity Type">
                <select value={legal_entity_type} onChange={(e) => set_legal_entity_type(e.target.value)} className={input_cls}>
                  <option value="">Select…</option>
                  {LEGAL_ENTITY_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Industry">
                <input type="text" value={industry} onChange={(e) => set_industry(e.target.value)} className={input_cls} placeholder="Retail, Construction, …" />
              </Field>
              <Field label="Business Start Date">
                <input type="date" value={business_start_date} onChange={(e) => set_business_start_date(e.target.value)} className={input_cls} />
              </Field>
              <Field label="City">
                <input type="text" value={company_city} onChange={(e) => set_company_city(e.target.value)} className={input_cls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="State">
                  <input type="text" value={company_state} onChange={(e) => set_company_state(e.target.value.toUpperCase())} className={input_cls} maxLength={2} placeholder="FL" />
                </Field>
                <Field label="ZIP">
                  <input type="text" value={company_zip_code} onChange={(e) => set_company_zip_code(e.target.value)} className={input_cls} />
                </Field>
              </div>
              <Field label="Employees">
                <input type="number" value={employees_count} onChange={(e) => set_employees_count(e.target.value)} className={input_cls} />
              </Field>
              <Field label="Business Phone">
                <input type="tel" value={phone} onChange={(e) => set_phone(e.target.value)} className={input_cls} />
              </Field>
              <div className="md:col-span-2 flex items-center gap-2">
                <input
                  id="bp_home_based"
                  type="checkbox"
                  checked={is_home_based}
                  onChange={(e) => set_is_home_based(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300"
                />
                <label htmlFor="bp_home_based" className="text-sm text-slate-700">Home-based business</label>
              </div>
            </div>
          </Section>

          {/* SECTION 2 — Financials + Funding ask */}
          <Section icon={<DollarSign className="h-4 w-4" />} title="Financials & Funding Ask">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Avg Monthly Deposits">
                <input type="number" value={avg_monthly_deposits} onChange={(e) => set_avg_monthly_deposits(e.target.value)} className={input_cls} placeholder="50000" />
              </Field>
              <Field label="Avg Annual Revenue">
                <input type="number" value={avg_annual_revenue} onChange={(e) => set_avg_annual_revenue(e.target.value)} className={input_cls} placeholder="600000" />
              </Field>
              <Field label="Capital Requested">
                <input type="number" value={capital_requested} onChange={(e) => set_capital_requested(e.target.value)} className={input_cls} placeholder="250000" />
              </Field>
              <div className="md:col-span-2">
                <Field label="Proposed Loan Type">
                  <div className="flex flex-wrap gap-1.5">
                    {FUNDING_OPTIONS.map((type) => {
                      const selected = proposed_loan_types.includes(type);
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => toggle_loan_type(type)}
                          className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
                            selected
                              ? "bg-emerald-500 text-white border-emerald-500"
                              : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-700"
                          }`}
                        >
                          {type}
                        </button>
                      );
                    })}
                  </div>
                  {proposed_loan_types.length > 0 && (
                    <p className="mt-2 text-[11px] font-bold text-emerald-600">
                      Selected: {proposed_loan_types.join(" · ")}
                    </p>
                  )}
                </Field>
              </div>
              <Field label="Funding ETA">
                <select value={funding_eta} onChange={(e) => set_funding_eta(e.target.value)} className={input_cls}>
                  <option value="">Select…</option>
                  {FUNDING_ETAS.map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
              </Field>
              <Field label="Loan Purpose">
                <input type="text" value={loan_purpose} onChange={(e) => set_loan_purpose(e.target.value)} className={input_cls} placeholder="Equipment, working capital, …" />
              </Field>
            </div>
          </Section>

          {/* SECTION 3 — Open positions */}
          <Section icon={<AlertTriangle className="h-4 w-4" />} title="Existing Debt on this Business (optional)">
            {open_positions.length === 0 ? (
              <p className="text-sm text-slate-500 mb-3">No existing positions added.</p>
            ) : (
              <div className="space-y-3 mb-3">
                {open_positions.map((p, idx) => (
                  <div key={idx} className="p-3 border border-slate-200 rounded-xl space-y-2">
                    {/* Row 1 — identity */}
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                      <input
                        type="text"
                        placeholder="Lender"
                        value={p.lender_name}
                        onChange={(e) => update_position(idx, { lender_name: e.target.value })}
                        className={input_cls + " md:col-span-3"}
                      />
                      <select
                        value={p.loan_type}
                        onChange={(e) => update_position(idx, { loan_type: e.target.value })}
                        className={input_cls + " md:col-span-2"}
                      >
                        <option value="">Loan type…</option>
                        {FUNDING_OPTIONS.map((t) => (<option key={t} value={t}>{t}</option>))}
                      </select>
                      <button
                        type="button"
                        onClick={() => remove_position(idx)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg justify-self-end"
                        aria-label="Remove position"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    {/* Row 2 — numbers + cadence */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        placeholder="Initial $"
                        value={p.initial_balance}
                        onChange={(e) => update_position(idx, { initial_balance: e.target.value })}
                        className={input_cls}
                      />
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        placeholder="Current balance"
                        value={p.current_balance}
                        onChange={(e) => update_position(idx, { current_balance: e.target.value })}
                        className={input_cls}
                      />
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        placeholder="Payment $"
                        value={p.payment_amount}
                        onChange={(e) => update_position(idx, { payment_amount: e.target.value })}
                        className={input_cls}
                      />
                      <select
                        value={p.payment_frequency}
                        onChange={(e) => update_position(idx, { payment_frequency: e.target.value })}
                        className={input_cls}
                      >
                        <option value="">Frequency…</option>
                        {PAYMENT_FREQUENCIES.map((f) => (<option key={f} value={f}>{f}</option>))}
                      </select>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        placeholder="# Remaining"
                        value={p.term_remaining}
                        onChange={(e) => update_position(idx, { term_remaining: e.target.value })}
                        className={input_cls}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {open_positions.length < 5 && (
              <button type="button" onClick={add_position} className="flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 px-3 py-2 rounded-lg">
                <Plus className="h-4 w-4" /> Add position
              </button>
            )}
          </Section>

          {/* SECTION 4 — Doc requests */}
          <Section icon={<FileCheck2 className="h-4 w-4" />} title="Documents to Request for this Business">
            <p className="text-xs text-slate-500 mb-3">
              Core docs are pre-selected. The client will see these docs in their vault, scoped to this business.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {all_doc_options.map((d) => {
                const checked = requested_doc_codes.has(d.code);
                return (
                  <label key={d.code} className="flex items-start gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle_doc(d.code)}
                      className="w-4 h-4 mt-0.5 rounded border-slate-300"
                    />
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{d.label}</p>
                      {d.is_core && <span className="text-[10px] font-bold uppercase text-emerald-700">Core</span>}
                    </div>
                  </label>
                );
              })}
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-slate-50 border-t border-slate-100 px-6 py-4 flex items-center justify-between rounded-b-2xl">
          <p className="text-xs text-slate-500">
            {requested_doc_codes.size} doc{requested_doc_codes.size === 1 ? "" : "s"} will be requested
            {open_positions.filter((p) => p.lender_name.trim()).length > 0 && (
              <> · {open_positions.filter((p) => p.lender_name.trim()).length} open position(s)</>
            )}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={close}
              disabled={is_submitting}
              className="px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={is_submitting || !company_name.trim()}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {is_submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {is_submitting ? "Creating…" : "Create Business + Vault"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reusable bits ────────────────────────────────────────────────────────────

const input_cls = "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white";

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">{icon}</div>
        <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wide">{title}</h4>
      </div>
      {children}
    </section>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
