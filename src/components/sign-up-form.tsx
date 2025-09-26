// src/components/advisor-signup-form.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useRouter } from "next/navigation";

type Owner = { first_name: string; last_name: string; ownership_pct: number };
type Loan = { balance?: number; lender_name?: string; term?: string };
type OutstandingLoans = { loan1?: Loan; loan2?: Loan; loan3?: Loan };

const DOC_OPTIONS = [
  "Funding Application",
  "Business Bank Statements",
  "Business/Personal Tax Returns",
  "Profit & Loss Stament",
  "Balance Sheet",
  "Debt Schedule",
  "A/R Report",
  "Driver's License",
  "Voided Check",
] as const;

export default function SignupForm() {
  const router = useRouter();

  // PASO 1 — Contact & Business
  const [first_name, setFirstName] = useState("");
  const [last_name, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company_legal_name, setCompanyLegal] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [amount_requested, setAmountRequested] = useState<number | "">("");
  const [legal_entity_type, setEntity] = useState("");
  const [industry_1, setIndustry1] = useState("");
  const [industry_2, setIndustry2] = useState("");
  const [industry_3, setIndustry3] = useState("");
  const [use_of_funds, setUseOfFunds] = useState("");

  // Owners
  const [owners, setOwners] = useState<Owner[]>([{ first_name: "", last_name: "", ownership_pct: 100 }]);

  // PASO 2 — Financials
  const [business_start_date, setStartDate] = useState(""); // yyyy-mm-dd
  const [avg_monthly_deposits, setMonthlyDeposits] = useState<number | "">("");
  const [annual_revenue, setAnnualRevenue] = useState<number | "">("");
  const [credit_score, setCreditScore] = useState<"700" | "680" | "650" | "600" | "400" | "">("");
  const [sbss_score, setSbss] = useState<number | "">("");

  // Loans (opcionales)
  const [outstanding_loans, setLoans] = useState<OutstandingLoans>({});

  // PASO 3 — Riesgos & Docs
  const [has_previous_debt, setPrevDebt] = useState<boolean>(false);
  const [defaulted_on_mca, setDefaulted] = useState<boolean>(false);
  const [reduced_mca_payments, setReduced] = useState<boolean>(false);
  const [owns_real_estate, setRealEstate] = useState<boolean>(false);
  const [personal_cc_debt_over_75k, setPcc75] = useState<boolean>(false);
  const [personal_cc_debt_amount, setPccAmount] = useState<number | "">("");
  const [foreclosures_or_bankruptcies_3y, setBkFc3y] = useState<boolean>(false);
  const [bk_fc_months_ago, setBkFcMonths] = useState<number | "">("");
  const [bk_fc_type, setBkFcType] = useState<string>("");
  const [tax_liens, setTaxLiens] = useState<boolean>(false);
  const [tax_liens_type, setTaxLiensType] = useState<string>("");
  const [tax_liens_amount, setTaxLiensAmount] = useState<number | "">("");
  const [tax_liens_on_plan, setTaxLiensPlan] = useState<boolean>(false);
  const [judgements, setJudgements] = useState<boolean>(false);
  const [judgements_explain, setJudgementsExplain] = useState<string>("");
  const [how_soon_funds, setHowSoon] = useState<string>("");
  const [employees_count, setEmployees] = useState<number | "">("");
  const [additional_info, setAdditional] = useState<string>("");

  // Docs solicitados (checklist final)
  const [documents_requested, setDocs] = useState<string[]>([]);

  // UI
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDoc = (label: string) => {
    setDocs(prev => (prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]));
  };

  const addOwner = () => setOwners(o => [...o, { first_name: "", last_name: "", ownership_pct: 0 }]);
  const removeOwner = (i: number) => setOwners(o => o.filter((_, idx) => idx !== i));
  const updateOwner = (i: number, patch: Partial<Owner>) =>
    setOwners(o => o.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // Validaciones mínimas de UI
      if (!first_name || !last_name) throw new Error("First/Last name are required.");
      if (!email) throw new Error("Email is required.");
      if (!company_legal_name) throw new Error("Company legal name is required.");
      if (!amount_requested || Number(amount_requested) <= 0) throw new Error("Funding goal must be a positive number.");
      if (!legal_entity_type) throw new Error("Entity type is required.");
      if (!avg_monthly_deposits && avg_monthly_deposits !== 0) throw new Error("Monthly revenue is required.");
      if (!annual_revenue && annual_revenue !== 0) throw new Error("Annual revenue is required.");
      if (!credit_score) throw new Error("Credit score is required.");

      // Construir payload que valida ClientSignupSchema
      const payload = {
        // CONTACT / COMPANY
        first_name,
        last_name,
        email: email.trim().toLowerCase(),
        phone,
        company_legal_name,
        city,
        state,
        zip,
        // GOAL
        amount_requested: Number(amount_requested),
        use_of_funds,
        // OWNERS
        owners_count: owners.length > 1 ? "more" as const : "one" as const,
        owners: owners.map(o => ({
          first_name: o.first_name.trim(),
          last_name: o.last_name.trim(),
          ownership_pct: Number(o.ownership_pct),
        })),
        // LEGAL + INDUSTRY
        legal_entity_type,
        industry_1: industry_1 || undefined,
        industry_2: industry_2 || undefined,
        industry_3: industry_3 || undefined,
        // DATES / MONEY
        business_start_date,
        avg_monthly_deposits: Number(avg_monthly_deposits || 0),
        annual_revenue: Number(annual_revenue || 0),
        // SCORES
        credit_score, // "700" | "680" | "650" | "600" | "400"
        sbss_score: sbss_score === "" ? undefined : Number(sbss_score),
        // DEBT & LOANS
        has_previous_debt,
        outstanding_loans,
        // RISKS
        defaulted_on_mca,
        reduced_mca_payments,
        owns_real_estate,
        personal_cc_debt_over_75k,
        judgements,
        personal_cc_debt_amount: personal_cc_debt_amount === "" ? undefined : Number(personal_cc_debt_amount),
        foreclosures_or_bankruptcies_3y,
        bk_fc_months_ago: bk_fc_months_ago === "" ? undefined : Number(bk_fc_months_ago),
        bk_fc_type: bk_fc_type || undefined,
        tax_liens,
        tax_liens_type: tax_liens_type || undefined,
        tax_liens_amount: tax_liens_amount === "" ? undefined : Number(tax_liens_amount),
        tax_liens_on_plan,
        judgements_explain: judgements_explain || undefined,
        // TIMING
        how_soon_funds: how_soon_funds || undefined,
        employees_count: employees_count === "" ? undefined : Number(employees_count),
        additional_info: additional_info || undefined,
        // DOCS
        documents_requested,
        // (opcional) advisor que hace el registro si lo tienes
        // advisor_id: "uuid-del-advisor"
      };

      const res = await fetch("/api/client-signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Signup failed");
      }

      // listo -> mostramos success (puedes redirigir a un success page)
      router.push("/auth/sign-up-success");
    } catch (err: any) {
      setError(err.message || "Error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle>New Client (Advisor)</CardTitle>
        <CardDescription>Complete the 3 steps. A magic link will be emailed to the client to set their password.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* STEPPER */}
        <div className="flex gap-2 text-sm">
          <span className={`px-2.5 py-1 rounded ${step === 1 ? "bg-emerald-600 text-white" : "bg-gray-100"}`}>1. Contact & Business</span>
          <span className={`px-2.5 py-1 rounded ${step === 2 ? "bg-emerald-600 text-white" : "bg-gray-100"}`}>2. Financials</span>
          <span className={`px-2.5 py-1 rounded ${step === 3 ? "bg-emerald-600 text-white" : "bg-gray-100"}`}>3. Risk & Docs</span>
        </div>

        {step === 1 && (
          <div className="space-y-6">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>First name</Label>
                <Input value={first_name} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div>
                <Label>Last name</Label>
                <Input value={last_name} onChange={(e) => setLastName(e.target.value)} required />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <Label>Company legal name</Label>
                <Input value={company_legal_name} onChange={(e) => setCompanyLegal(e.target.value)} required />
              </div>
              <div>
                <Label>City</Label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div>
                <Label>State</Label>
                <Input value={state} onChange={(e) => setState(e.target.value)} />
              </div>
              <div>
                <Label>ZIP</Label>
                <Input value={zip} onChange={(e) => setZip(e.target.value)} />
              </div>
              <div>
                <Label>Funding goal (USD)</Label>
                <Input type="number" value={amount_requested} onChange={(e) => setAmountRequested(e.target.value === "" ? "" : Number(e.target.value))} />
              </div>
              <div>
                <Label>Entity type</Label>
                <Select onValueChange={setEntity} value={legal_entity_type}>
                  <SelectTrigger><SelectValue placeholder="Select entity" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LLC">LLC</SelectItem>
                    <SelectItem value="S-Corp">S-Corp</SelectItem>
                    <SelectItem value="C-Corp">C-Corp</SelectItem>
                    <SelectItem value="Sole Prop">Sole Prop</SelectItem>
                    <SelectItem value="Partnership">Partnership</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label>Use of funds</Label>
                <Textarea rows={2} value={use_of_funds} onChange={(e) => setUseOfFunds(e.target.value)} />
              </div>
              <div>
                <Label>Industry (primary)</Label>
                <Input value={industry_1} onChange={(e) => setIndustry1(e.target.value)} />
              </div>
              <div>
                <Label>Industry (secondary)</Label>
                <Input value={industry_2} onChange={(e) => setIndustry2(e.target.value)} />
              </div>
              <div>
                <Label>Industry (tertiary)</Label>
                <Input value={industry_3} onChange={(e) => setIndustry3(e.target.value)} />
              </div>
            </div>

            {/* Owners */}
            <div className="space-y-3">
              <div className="font-medium">Owners</div>
              {owners.map((o, i) => (
                <div key={i} className="grid md:grid-cols-4 gap-3 items-end">
                  <div><Label>First</Label><Input value={o.first_name} onChange={e => updateOwner(i, { first_name: e.target.value })} /></div>
                  <div><Label>Last</Label><Input value={o.last_name} onChange={e => updateOwner(i, { last_name: e.target.value })} /></div>
                  <div><Label>% Ownership</Label><Input type="number" value={o.ownership_pct} onChange={e => updateOwner(i, { ownership_pct: Number(e.target.value) })} /></div>
                  <div className="flex gap-2">
                    {owners.length > 1 && (
                      <Button type="button" variant="outline" onClick={() => removeOwner(i)} className="w-full">Remove</Button>
                    )}
                    {i === owners.length - 1 && (
                      <Button type="button" onClick={addOwner} className="w-full">Add Owner</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <Button onClick={() => setStep(2)}>Next</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Business start date</Label>
                <Input type="date" value={business_start_date} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label>Avg. monthly deposits (USD)</Label>
                <Input type="number" value={avg_monthly_deposits} onChange={(e) => setMonthlyDeposits(e.target.value === "" ? "" : Number(e.target.value))} />
              </div>
              <div>
                <Label>Annual revenue last year (USD)</Label>
                <Input type="number" value={annual_revenue} onChange={(e) => setAnnualRevenue(e.target.value === "" ? "" : Number(e.target.value))} />
              </div>
              <div>
                <Label>Credit score</Label>
                <Select value={credit_score} onValueChange={(v) => setCreditScore(v as any)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="700">700+</SelectItem>
                    <SelectItem value="680">680–699</SelectItem>
                    <SelectItem value="650">650–679</SelectItem>
                    <SelectItem value="600">600–649</SelectItem>
                    <SelectItem value="400">≤599</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>SBSS score (optional)</Label>
                <Input type="number" value={sbss_score} onChange={(e) => setSbss(e.target.value === "" ? "" : Number(e.target.value))} />
              </div>
            </div>

            {/* Loans (simple) */}
            <div className="space-y-3">
              <div className="font-medium">Outstanding loans (optional)</div>
              {[1,2,3].map(n => (
                <div key={n} className="grid md:grid-cols-3 gap-3">
                  <div><Label>Lender #{n}</Label>
                    <Input
                      value={(outstanding_loans as any)[`loan${n}`]?.lender_name || ""}
                      onChange={(e) => setLoans(prev => ({
                        ...prev,
                        [`loan${n}`]: { ...(prev as any)[`loan${n}`], lender_name: e.target.value }
                      }))}
                    />
                  </div>
                  <div><Label>Balance</Label>
                    <Input
                      type="number"
                      value={(outstanding_loans as any)[`loan${n}`]?.balance ?? ""}
                      onChange={(e) => setLoans(prev => ({
                        ...prev,
                        [`loan${n}`]: { ...(prev as any)[`loan${n}`], balance: e.target.value === "" ? undefined : Number(e.target.value) }
                      }))}
                    />
                  </div>
                  <div><Label>Term</Label>
                    <Input
                      placeholder="e.g. 12 months"
                      value={(outstanding_loans as any)[`loan${n}`]?.term || ""}
                      onChange={(e) => setLoans(prev => ({
                        ...prev,
                        [`loan${n}`]: { ...(prev as any)[`loan${n}`], term: e.target.value }
                      }))}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)}>Next</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="flex items-center gap-2"><Checkbox checked={has_previous_debt} onCheckedChange={v => setPrevDebt(Boolean(v))} /><Label>Has previous debt?</Label></div>
              <div className="flex items-center gap-2"><Checkbox checked={defaulted_on_mca} onCheckedChange={v => setDefaulted(Boolean(v))} /><Label>Defaulted on MCA</Label></div>
              <div className="flex items-center gap-2"><Checkbox checked={reduced_mca_payments} onCheckedChange={v => setReduced(Boolean(v))} /><Label>Reduced MCA payments</Label></div>
              <div className="flex items-center gap-2"><Checkbox checked={owns_real_estate} onCheckedChange={v => setRealEstate(Boolean(v))} /><Label>Owns real estate</Label></div>
              <div className="flex items-center gap-2"><Checkbox checked={personal_cc_debt_over_75k} onCheckedChange={v => setPcc75(Boolean(v))} /><Label>Personal CC debt &gt; 75k</Label></div>
              <div>
                <Label>Personal CC debt amount (if any)</Label>
                <Input type="number" value={personal_cc_debt_amount} onChange={e => setPccAmount(e.target.value === "" ? "" : Number(e.target.value))} />
              </div>
              <div className="flex items-center gap-2"><Checkbox checked={foreclosures_or_bankruptcies_3y} onCheckedChange={v => setBkFc3y(Boolean(v))} /><Label>BK/FC in last 3y</Label></div>
              <div><Label>BK/FC months ago</Label><Input type="number" value={bk_fc_months_ago} onChange={e => setBkFcMonths(e.target.value === "" ? "" : Number(e.target.value))} /></div>
              <div><Label>BK/FC type</Label><Input value={bk_fc_type} onChange={e => setBkFcType(e.target.value)} placeholder="foreclosure | bankruptcy | both" /></div>
              <div className="flex items-center gap-2"><Checkbox checked={tax_liens} onCheckedChange={v => setTaxLiens(Boolean(v))} /><Label>Tax liens</Label></div>
              <div><Label>Tax liens type</Label><Input value={tax_liens_type} onChange={e => setTaxLiensType(e.target.value)} placeholder="personal | business" /></div>
              <div><Label>Tax liens amount</Label><Input type="number" value={tax_liens_amount} onChange={e => setTaxLiensAmount(e.target.value === "" ? "" : Number(e.target.value))} /></div>
              <div className="flex items-center gap-2"><Checkbox checked={tax_liens_on_plan} onCheckedChange={v => setTaxLiensPlan(Boolean(v))} /><Label>On payment plan</Label></div>
              <div className="flex items-center gap-2"><Checkbox checked={judgements} onCheckedChange={v => setJudgements(Boolean(v))} /><Label>Judgements</Label></div>
              <div className="md:col-span-2"><Label>Judgements — explain</Label><Textarea rows={2} value={judgements_explain} onChange={e => setJudgementsExplain(e.target.value)} /></div>
              <div><Label>How soon do they need funds?</Label><Input value={how_soon_funds} onChange={e => setHowSoon(e.target.value)} placeholder="ASAP, 1–2 weeks, etc." /></div>
              <div><Label>Employees</Label><Input type="number" value={employees_count} onChange={e => setEmployees(e.target.value === "" ? "" : Number(e.target.value))} /></div>
              <div className="md:col-span-3"><Label>Additional info</Label><Textarea rows={2} value={additional_info} onChange={e => setAdditional(e.target.value)} /></div>
            </div>

            {/* Docs checklist */}
            <div>
              <div className="font-medium mb-2">Documents requested</div>
              <div className="grid md:grid-cols-2 gap-2">
                {DOC_OPTIONS.map((label) => (
                  <label key={label} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={documents_requested.includes(label)} onCheckedChange={() => toggleDoc(label)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting ? "Submitting..." : "Create Client & Send Magic Link"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
