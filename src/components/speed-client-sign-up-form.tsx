"use client";

// SPEED FORM — the fast-track client signup used by reps during the call.
//
// Trimmed to the MINIMUM the advisor must type, laid out as a short 3-step
// wizard (Business → Funding → Documents) — the same stepped UX as the full
// form, just far fewer steps. Everything else on the funding application
// (Federal Tax ID, SSN, industry, addresses, owner DOB, etc.) is collected
// from the CLIENT in onboarding Step 1 — the speed-form client is NOT
// fast-forwarded past it.
//
// Flow: submit → client gets a magic link → client completes onboarding Step 1
// → client signs the pre-filled SignWell application → documents are released
// (see /api/webhooks/signwell-contract → releaseSpeedFormDocs).
//
// The full 7-step form (client-sign-up-form.tsx) is untouched and remains the
// standard flow.

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Building2,
  DollarSign,
  FileText,
  Zap,
  AlertCircle,
  Copy,
  Check,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { useErrorDialog } from "@/components/error-dialog";
import { FUNDING_OPTIONS } from "@/data/loan-types";

// FICO buckets MUST match the "Approximate Credit Score" checkboxes on the
// SignWell FUNDING APPLICATION template (400-500 / 500-600 / 600-700 / 700+).
const CREDIT_SCORE_OPTIONS = [
  { value: '400-500', label: '400 – 500' },
  { value: '500-600', label: '500 – 600' },
  { value: '600-700', label: '600 – 700' },
  { value: '700+', label: '700+' },
];

const LEGAL_ENTITY_TYPES = ['LLC', 'C-Corp', 'S-Corp', 'Sole Prop', 'Other'];

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

// label → required_documents.code (the API receives codes)
const DOC_OPTIONS: { code: string; label: string }[] = [
  { code: 'business_bank_statements', label: 'Business Bank Statements' },
  { code: 'tax_returns', label: 'Business/Personal Tax Returns' },
  { code: 'profit_loss', label: 'Profit & Loss Statement' },
  { code: 'balance_sheets', label: 'Balance Sheet' },
  { code: 'debt_schedule', label: 'Debt Schedule' },
  { code: 'ar_report', label: 'A/R Report' },
  { code: 'drivers_license', label: "Driver's License" },
  { code: 'voided_check', label: 'Voided Check' },
];

const STEPS = [
  { num: 1, label: "Business", icon: Building2 },
  { num: 2, label: "Funding", icon: DollarSign },
  { num: 3, label: "Documents", icon: FileText },
];

const inputClass = "h-12 rounded-xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-5";
const labelClass = "text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-1.5 block ml-1";

export default function SpeedClientSignUpForm({ isSetter = false }: { isSetter?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  // Setters get a trimmed 2-step form: no document picker and no loan-type
  // picker. Documents auto-set to business bank statements and the proposed
  // loan type to "other" — the assigned advisor refines the client afterward.
  // (Also enforced server-side in /api/client-signup-speed for role=setter.)
  const steps = isSetter ? STEPS.slice(0, 2) : STEPS;
  const [step, set_step] = useState(1);
  const [submitting, set_submitting] = useState(false);
  const { showError } = useErrorDialog();

  // ===== Step 1 — Contact & Business (the minimum the advisor types) =====
  const [client_name, set_client_name] = useState("");
  const [company_name, set_company_name] = useState("");
  const [client_phone, set_client_phone] = useState("");
  const [client_email, set_client_email] = useState("");
  const [legal_entity_type, set_legal_entity_type] = useState("");
  const [business_start_date, set_business_start_date] = useState("");
  const [company_city, set_company_city] = useState("");
  const [company_state, set_company_state] = useState("");
  const [company_zip_code, set_company_zip_code] = useState("");

  // ===== Step 2 — Funding Request =====
  const [capital_requested, set_capital_requested] = useState("");
  const [avg_annual_revenue, set_avg_annual_revenue] = useState("");
  const [avg_monthly_deposits, set_avg_monthly_deposits] = useState("");
  const [credit_score, set_credit_score] = useState("");
  const [loan_purpose, set_loan_purpose] = useState("");
  const [proposed_loan_types, set_proposed_loan_types] = useState<string[]>([]);
  // Setters collect call notes here (in place of "Use of Funds") so the
  // assigned advisor opens the file with context already on it.
  const [additional_notes, set_additional_notes] = useState("");

  // ===== Step 3 — Documents Requested (released only after the client signs) =====
  // Setters skip this step; default to business bank statements only.
  const [documents_requested, set_documents_requested] = useState<string[]>(
    isSetter ? ["business_bank_statements"] : []
  );

  // ===== Success state =====
  const [show_success, set_show_success] = useState(false);
  const [created_client_email, set_created_client_email] = useState("");
  const [created_client_name, set_created_client_name] = useState("");
  const [created_magic_link, set_created_magic_link] = useState("");
  const [link_copied, set_link_copied] = useState(false);

  const toggle_document = (code: string) => {
    set_documents_requested((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code]
    );
  };

  const toggle_loan_type = (type: string) => {
    set_proposed_loan_types((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  // The speed form is advisor/admin-only (the route is already middleware
  // protected); we only check the session exists so submit doesn't 401 late.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) router.push("/auth/login");
    })();
  }, [supabase, router]);

  // Per-step validation — returns the first error message, or null if the step
  // is complete. Used to gate "Next" and the final submit.
  const validate_step = (n: number): string | null => {
    if (n === 1) {
      const required: [string, string][] = [
        [client_name, "Client Full Name"],
        [company_name, "Company Name"],
        [client_phone, "Cell Phone #"],
        [client_email, "Email Address"],
        [legal_entity_type, "Type of Business Entity"],
        [business_start_date, "Business Start Date"],
        [company_city, "Business City"],
        [company_state, "Business State"],
        [company_zip_code, "Business Zip Code"],
      ];
      const missing = required.filter(([v]) => !v.trim()).map(([, label]) => label);
      if (missing.length > 0) return `Please complete: ${missing.join(", ")}`;
    }
    if (n === 2) {
      const required: [string, string][] = [
        [avg_annual_revenue, "Gross Annual Revenue"],
        [avg_monthly_deposits, "Monthly Bank Deposit Volume"],
        [capital_requested, "Funding Amount Requested"],
        [credit_score, "Approximate Credit Score"],
        // Setters capture call notes here instead of "Use of Funds".
        isSetter ? [additional_notes, "Call Notes"] : [loan_purpose, "Use of Funds"],
      ];
      const missing = required.filter(([v]) => !v.trim()).map(([, label]) => label);
      if (missing.length > 0) return `Please complete: ${missing.join(", ")}`;
      // Setters don't pick a loan type — it's auto-set to "other".
      if (!isSetter && proposed_loan_types.length === 0) return "Select at least one proposed loan type.";
    }
    if (n === 3) {
      if (documents_requested.length === 0) return "Select at least one document to request.";
    }
    return null;
  };

  const go_next = () => {
    const err = validate_step(step);
    if (err) {
      showError(new Error(err), { context: "Speed form" });
      return;
    }
    set_step((s) => Math.min(s + 1, steps.length));
  };

  const go_back = () => set_step((s) => Math.max(s - 1, 1));

  const handle_submit = async () => {
    set_submitting(true);
    try {
      for (let n = 1; n <= steps.length; n++) {
        const err = validate_step(n);
        if (err) {
          set_step(n);
          throw new Error(err);
        }
      }

      const payload = {
        // Contact & business
        client_name,
        company_name,
        client_phone,
        client_email,
        legal_entity_type,
        business_start_date,
        company_city,
        company_state,
        company_zip_code,

        // Funding
        avg_annual_revenue,
        avg_monthly_deposits,
        capital_requested,
        credit_score,
        loan_purpose,
        // Call notes (setters) → advisor-visible additional_notes on the vault.
        additional_notes,
        // Setters never pick a loan type — it's auto-set to "other".
        proposed_loan_type: isSetter ? "other" : proposed_loan_types.join(", "),

        // Doc codes — parked server-side until the application is signed.
        // For setters this is auto-set to business bank statements only.
        documents_requested,
      };

      const res = await fetch("/api/client-signup-speed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const error_data = await res.json().catch(() => ({}));
        throw new Error(error_data?.error || "Speed form signup failed");
      }

      const result = await res.json();

      set_created_client_email(client_email);
      set_created_client_name(client_name);
      set_created_magic_link(result?.credentials?.magic_link || "");
      set_show_success(true);
    } catch (err: any) {
      showError(err, { context: "Creating the client (speed form)" });
    } finally {
      set_submitting(false);
    }
  };

  const copy_magic_link = async () => {
    if (!created_magic_link) return;
    try {
      await navigator.clipboard.writeText(created_magic_link);
      set_link_copied(true);
      setTimeout(() => set_link_copied(false), 2500);
    } catch {
      // Clipboard can fail in non-secure contexts — the link is still visible to select manually.
    }
  };

  return (
    <div className="relative overflow-hidden rounded-[3rem] bg-[#f0fdf7]">
      {/* aurora-glow effect for consistency */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/30 via-white/80 to-white pointer-events-none" />
      <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-emerald-200/10 blur-[120px] rounded-full pointer-events-none animate-aurora" />

      {/* Success Modal — surfaces the magic link so the rep can walk the client
          through onboarding Step 1 and the signature while still on the call. */}
      {show_success && (
        <div className="fixed inset-0 bg-emerald-950/40 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[3rem] shadow-2xl max-w-2xl w-full p-10 md:p-14 animate-fade-in relative overflow-hidden border border-emerald-50">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full blur-3xl -mr-10 -mt-10" />

            <div className="text-center mb-8 relative z-10">
              <div className="mx-auto w-24 h-24 bg-emerald-50 rounded-[2rem] flex items-center justify-center mb-6 border border-emerald-100 shadow-inner">
                <Zap className="w-12 h-12 text-emerald-500" />
              </div>
              <h2 className="text-4xl font-black text-emerald-950 uppercase tracking-tighter mb-3">
                Speed Form Submitted!
              </h2>
              <p className="text-emerald-950/40 font-bold text-lg">
                {created_client_name} can now finish their application.
              </p>
            </div>

            {created_magic_link && (
              <div className="bg-emerald-50/50 rounded-[2rem] p-6 mb-6 border border-emerald-50 relative z-10">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-900/30 mb-2">
                  Client Link — share it now, while on the call
                </p>
                <div className="flex items-center gap-3">
                  <p className="text-sm font-bold text-emerald-950 break-all flex-1">{created_magic_link}</p>
                  <Button
                    onClick={copy_magic_link}
                    variant="outline"
                    className="shrink-0 h-12 px-4 border-2 border-emerald-100 rounded-xl font-black"
                  >
                    {link_copied ? <Check className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5" />}
                    <span className="ml-2">{link_copied ? "Copied" : "Copy"}</span>
                  </Button>
                </div>
                <p className="text-xs font-bold text-emerald-900/40 mt-3">
                  The same link was emailed (and texted via GHL) to {created_client_email}. It opens their
                  onboarding — they fill the remaining application details (Tax ID, SSN, addresses), then
                  sign — no password needed.
                </p>
              </div>
            )}

            <div className="bg-emerald-950 rounded-[2rem] p-6 mb-8 relative z-10">
              <p className="text-sm font-bold text-emerald-50/60 leading-relaxed text-center">
                📄 The document request {documents_requested.length > 0 ? `(${documents_requested.length} item${documents_requested.length === 1 ? "" : "s"}) ` : ""}
                will be sent automatically <span className="text-white">after the client signs the application</span>.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 relative z-10">
              <Button
                onClick={() => window.location.reload()}
                className="flex-1 h-14 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95"
              >
                Create Another
              </Button>
              {/* Setters have a create-only dashboard — no prospect list to link to. */}
              {!isSetter && (
                <Button
                  onClick={() => router.push(pathname.startsWith('/admin') ? '/admin/prospects' : '/advisor/dashboard/prospects')}
                  variant="outline"
                  className="flex-1 h-14 border-2 border-emerald-100 text-emerald-950 font-black rounded-2xl hover:bg-emerald-50 transition-all active:scale-95"
                >
                  View Prospect List
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-5xl mx-auto px-4 py-6">
        <Card className="shadow-2xl border-emerald-50 rounded-3xl overflow-hidden relative z-10 bg-white">
          <CardHeader className="border-b border-emerald-50 bg-white p-6 md:p-8">
            <CardTitle className="text-2xl font-black text-emerald-950 uppercase tracking-tighter flex items-center gap-3">
              <Zap className="w-7 h-7 text-emerald-500" />
              Speed Form
            </CardTitle>
            <CardDescription className="text-sm font-bold text-emerald-900/40 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>
                Fast-track application for use during the call — document requests go out only after the client signs.
              </span>
              <span className="text-xs text-emerald-600/80 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100 flex items-center gap-2 shrink-0">
                <AlertCircle className="w-3.5 h-3.5" />
                <span><span className="text-emerald-500 font-black">*</span> required</span>
              </span>
            </CardDescription>
          </CardHeader>

          <CardContent className="p-5 md:p-7">
            <div className="flex flex-col md:flex-row gap-6 md:gap-10">
              {/* Vertical step rail */}
              <aside className="md:w-56 shrink-0">
                <div className="flex flex-row md:flex-col gap-2 overflow-x-auto md:overflow-visible pb-1 scrollbar-hide">
                  {steps.map((s) => {
                    const active = step === s.num;
                    const done = step > s.num;
                    return (
                      <button
                        key={s.num}
                        type="button"
                        onClick={() => set_step(s.num)}
                        className={`flex items-center gap-3 rounded-2xl p-3 text-left shrink-0 md:w-full transition-all active:scale-[0.98] ${active ? "bg-emerald-50 border border-emerald-100" : "border border-transparent hover:bg-slate-50"}`}
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black shrink-0 transition-all duration-500 ${active ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : done ? "bg-emerald-50 text-emerald-500 border border-emerald-100" : "bg-slate-50 text-slate-300 border border-slate-100"}`}>
                          {done ? <CheckCircle2 className="w-5 h-5" /> : <s.icon className="w-5 h-5" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none mb-1">Step {s.num}</p>
                          <p className={`text-sm font-black leading-none ${active ? "text-emerald-950" : "text-slate-500"}`}>{s.label}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </aside>

              {/* Step content */}
              <div className="flex-1 min-w-0">
              {/* ===== STEP 1: CONTACT & BUSINESS ===== */}
              {step === 1 && (
                <div className="space-y-6 animate-fade-in">
                  <div className="bg-emerald-50/50 rounded-2xl p-5 mb-6">
                    <h3 className="text-xl font-black text-emerald-950 uppercase tracking-tighter mb-2">Contact &amp; Business</h3>
                    <p className="text-emerald-900/40 font-bold">The basics — the client fills the rest during onboarding.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div>
                      <Label htmlFor="client_name" className={labelClass}>Client Full Name *</Label>
                      <Input id="client_name" value={client_name} onChange={(e) => set_client_name(e.target.value)} className={inputClass} placeholder="John Doe" required />
                    </div>
                    <div>
                      <Label htmlFor="company_name" className={labelClass}>Company Name *</Label>
                      <Input id="company_name" value={company_name} onChange={(e) => set_company_name(e.target.value)} className={inputClass} placeholder="Acme Corp LLC" required />
                    </div>
                    <div>
                      <Label htmlFor="client_phone" className={labelClass}>Cell Phone # *</Label>
                      <Input id="client_phone" type="tel" value={client_phone} onChange={(e) => set_client_phone(e.target.value)} className={inputClass} placeholder="(555) 123-4567" required />
                    </div>
                    <div>
                      <Label htmlFor="client_email" className={labelClass}>Email Address *</Label>
                      <Input id="client_email" type="email" value={client_email} onChange={(e) => set_client_email(e.target.value)} className={inputClass} placeholder="john@example.com" required />
                    </div>
                    <div>
                      <Label htmlFor="legal_entity_type" className={labelClass}>Type of Business Entity *</Label>
                      <Select value={legal_entity_type} onValueChange={set_legal_entity_type}>
                        <SelectTrigger className={inputClass}>
                          <SelectValue placeholder="Select entity type" />
                        </SelectTrigger>
                        <SelectContent>
                          {LEGAL_ENTITY_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>{type}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="business_start_date" className={labelClass}>Business Start Date *</Label>
                      <Input id="business_start_date" type="date" value={business_start_date} onChange={(e) => set_business_start_date(e.target.value)} className={inputClass} required />
                    </div>
                    <div>
                      <Label htmlFor="company_city" className={labelClass}>Business City *</Label>
                      <Input id="company_city" value={company_city} onChange={(e) => set_company_city(e.target.value)} className={inputClass} placeholder="Los Angeles" required />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="company_state" className={labelClass}>State *</Label>
                        <Select value={company_state} onValueChange={set_company_state}>
                          <SelectTrigger className={inputClass}>
                            <SelectValue placeholder="State" />
                          </SelectTrigger>
                          <SelectContent>
                            {US_STATES.map((st) => (
                              <SelectItem key={st} value={st}>{st}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="company_zip_code" className={labelClass}>Zip Code *</Label>
                        <Input id="company_zip_code" value={company_zip_code} onChange={(e) => set_company_zip_code(e.target.value)} className={inputClass} placeholder="90210" required />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-8">
                    <Button
                      onClick={go_next}
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black rounded-2xl px-10 py-6 shadow-xl shadow-emerald-500/20 transition-all active:scale-95"
                    >
                      Next: Funding
                      <ChevronRight className="ml-2 w-5 h-5" />
                    </Button>
                  </div>
                </div>
              )}

              {/* ===== STEP 2: FUNDING REQUEST ===== */}
              {step === 2 && (
                <div className="space-y-6 animate-fade-in">
                  <div className="bg-emerald-50/50 rounded-2xl p-5 mb-6">
                    <h3 className="text-xl font-black text-emerald-950 uppercase tracking-tighter mb-2">Funding Request</h3>
                    <p className="text-emerald-900/40 font-bold">Revenue, the ask, and what it's for.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div>
                      <Label htmlFor="avg_annual_revenue" className={labelClass}>Gross Annual Revenue *</Label>
                      <div className="relative">
                        <span className="absolute left-6 top-1/2 -translate-y-1/2 text-emerald-950 font-black">$</span>
                        <Input id="avg_annual_revenue" type="number" value={avg_annual_revenue} onChange={(e) => set_avg_annual_revenue(e.target.value)} className={`${inputClass} pl-10`} placeholder="500000" required />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="avg_monthly_deposits" className={labelClass}>Monthly Bank Deposit Volume *</Label>
                      <div className="relative">
                        <span className="absolute left-6 top-1/2 -translate-y-1/2 text-emerald-950 font-black">$</span>
                        <Input id="avg_monthly_deposits" type="number" value={avg_monthly_deposits} onChange={(e) => set_avg_monthly_deposits(e.target.value)} className={`${inputClass} pl-10`} placeholder="40000" required />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="capital_requested" className={labelClass}>Funding Amount Requested *</Label>
                      <div className="relative">
                        <span className="absolute left-6 top-1/2 -translate-y-1/2 text-emerald-950 font-black">$</span>
                        <Input id="capital_requested" type="number" value={capital_requested} onChange={(e) => set_capital_requested(e.target.value)} className={`${inputClass} pl-10`} placeholder="50000" required />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="credit_score" className={labelClass}>Approximate Credit Score *</Label>
                      <Select value={credit_score} onValueChange={set_credit_score}>
                        <SelectTrigger className={inputClass}>
                          <SelectValue placeholder="Select FICO range" />
                        </SelectTrigger>
                        <SelectContent>
                          {CREDIT_SCORE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {isSetter ? (
                      <div className="md:col-span-2">
                        <Label htmlFor="additional_notes" className={labelClass}>Call Notes *</Label>
                        <Textarea id="additional_notes" value={additional_notes} onChange={(e) => set_additional_notes(e.target.value)} className="rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold p-6" placeholder="Everything you collected on the call — use of funds, urgency, situation, anything the advisor should know." rows={4} required />
                      </div>
                    ) : (
                      <div className="md:col-span-2">
                        <Label htmlFor="loan_purpose" className={labelClass}>Use of Funds *</Label>
                        <Textarea id="loan_purpose" value={loan_purpose} onChange={(e) => set_loan_purpose(e.target.value)} className="rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold p-6" placeholder="Equipment purchase, inventory, expansion, etc." rows={2} required />
                      </div>
                    )}
                    {!isSetter && (
                    <div className="md:col-span-2">
                      <Label className={`${labelClass} mb-3`}>
                        Proposed Loan Type * <span className="normal-case font-bold text-emerald-500">(select all that apply)</span>
                      </Label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {FUNDING_OPTIONS.map((type) => {
                          const selected = proposed_loan_types.includes(type);
                          return (
                            <button
                              key={type}
                              type="button"
                              onClick={() => toggle_loan_type(type)}
                              className={`flex items-center gap-2 px-4 py-3 rounded-2xl border text-sm font-black transition-all duration-200 ${selected
                                ? "bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                                : "bg-white border-emerald-100 text-emerald-950 hover:border-emerald-300"
                                }`}
                            >
                              <span className={`w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${selected ? "bg-white border-white" : "border-emerald-200"}`}>
                                {selected && (
                                  <svg className="w-2.5 h-2.5 text-emerald-500" viewBox="0 0 10 8" fill="none">
                                    <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </span>
                              {type}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    )}
                  </div>

                  <div className="flex justify-between pt-8">
                    <Button
                      onClick={go_back}
                      variant="outline"
                      className="border-2 border-emerald-100 text-emerald-950 font-black rounded-2xl px-10 py-6 hover:bg-emerald-50 transition-all active:scale-95"
                    >
                      <ChevronLeft className="mr-2 w-5 h-5" />
                      Back
                    </Button>
                    {isSetter ? (
                      // Setter form ends at step 2 — submit here (no documents step).
                      <Button
                        onClick={handle_submit}
                        disabled={submitting}
                        className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black rounded-2xl px-12 py-6 text-lg shadow-xl shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-60"
                      >
                        {submitting ? (
                          "Creating Client..."
                        ) : (
                          <span className="flex items-center gap-2">
                            <Zap className="w-5 h-5" />
                            Create Client &amp; Get Link
                          </span>
                        )}
                      </Button>
                    ) : (
                      <Button
                        onClick={go_next}
                        className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black rounded-2xl px-10 py-6 shadow-xl shadow-emerald-500/20 transition-all active:scale-95"
                      >
                        Next: Documents
                        <ChevronRight className="ml-2 w-5 h-5" />
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* ===== STEP 3: DOCUMENTS NEEDED ===== */}
              {step === 3 && (
                <div className="space-y-6 animate-fade-in">
                  <div className="bg-emerald-50/50 rounded-2xl p-5 mb-6">
                    <h3 className="text-xl font-black text-emerald-950 uppercase tracking-tighter mb-2">Documents Needed</h3>
                    <p className="text-emerald-900/40 font-bold">Requested automatically AFTER the client signs the application.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {DOC_OPTIONS.map((doc) => {
                      const selected = documents_requested.includes(doc.code);
                      return (
                        <button
                          key={doc.code}
                          type="button"
                          onClick={() => toggle_document(doc.code)}
                          className={`flex items-center gap-2 px-4 py-3 rounded-2xl border text-sm font-black transition-all duration-200 ${selected
                            ? "bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                            : "bg-white border-emerald-100 text-emerald-950 hover:border-emerald-300"
                            }`}
                        >
                          <span className={`w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${selected ? "bg-white border-white" : "border-emerald-200"}`}>
                            {selected && (
                              <svg className="w-2.5 h-2.5 text-emerald-500" viewBox="0 0 10 8" fill="none">
                                <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                          {doc.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs font-bold text-emerald-900/40 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    The document request email (including the proposed loan type and funding amount) is sent
                    automatically once the client signs — nothing goes out before that.
                  </p>

                  <div className="flex justify-between pt-8">
                    <Button
                      onClick={go_back}
                      variant="outline"
                      className="border-2 border-emerald-100 text-emerald-950 font-black rounded-2xl px-10 py-6 hover:bg-emerald-50 transition-all active:scale-95"
                    >
                      <ChevronLeft className="mr-2 w-5 h-5" />
                      Back
                    </Button>
                    <Button
                      onClick={handle_submit}
                      disabled={submitting}
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black rounded-2xl px-12 py-6 text-lg shadow-xl shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-60"
                    >
                      {submitting ? (
                        "Creating Client..."
                      ) : (
                        <span className="flex items-center gap-2">
                          <Zap className="w-5 h-5" />
                          Create Client &amp; Get Link
                        </span>
                      )}
                    </Button>
                  </div>
                </div>
              )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
