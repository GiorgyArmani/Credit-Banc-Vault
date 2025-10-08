// src/components/sign-up-form.tsx
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
import { ChevronRight, ChevronLeft, Building2, DollarSign, FileText, CheckCircle2 } from "lucide-react";

const DOC_OPTIONS = [
  "Funding Application",
  "Business Bank Statements",
  "Business/Personal Tax Returns",
  "Profit & Loss Statement",
  "Balance Sheet",
  "Debt Schedule",
  "A/R Report",
  "Driver's License",
  "Voided Check",
] as const;

export default function SignUpForm() {
  const router = useRouter();
  const [step, set_step] = useState(1);
  const [submitting, set_submitting] = useState(false);
  const [error, set_error] = useState("");

  // STEP 1 — Contact & Business
  const [first_name, set_first_name] = useState("");
  const [last_name, set_last_name] = useState("");
  const [email, set_email] = useState("");
  const [phone, set_phone] = useState("");
  const [company_legal_name, set_company_legal_name] = useState("");
  const [city, set_city] = useState("");
  const [state, set_state] = useState("");
  const [zip, set_zip] = useState("");
  const [amount_requested, set_amount_requested] = useState<number | "">("");
  const [legal_entity_type, set_legal_entity_type] = useState("");
  const [industry_1, set_industry_1] = useState("");
  const [use_of_funds, set_use_of_funds] = useState("");

  // STEP 2 — Financials
  const [business_start_date, set_business_start_date] = useState("");
  const [avg_monthly_deposits, set_avg_monthly_deposits] = useState<number | "">("");
  const [annual_revenue, set_annual_revenue] = useState<number | "">("");
  const [credit_score, set_credit_score] = useState("");
  const [sbss_score, set_sbss_score] = useState<number | "">("");

  // STEP 3 — Risk & Docs
  const [has_previous_debt, set_has_previous_debt] = useState(false);
  const [defaulted_on_mca, set_defaulted_on_mca] = useState(false);
  const [reduced_mca_payments, set_reduced_mca_payments] = useState(false);
  const [owns_real_estate, set_owns_real_estate] = useState(false);
  const [personal_cc_debt_over_75k, set_personal_cc_debt_over_75k] = useState(false);
  const [personal_cc_debt_amount, set_personal_cc_debt_amount] = useState<number | "">("");
  const [foreclosures_or_bankruptcies_3y, set_foreclosures_or_bankruptcies_3y] = useState(false);
  const [bk_fc_months_ago, set_bk_fc_months_ago] = useState<number | "">("");
  const [bk_fc_type, set_bk_fc_type] = useState("");
  const [tax_liens, set_tax_liens] = useState(false);
  const [tax_liens_type, set_tax_liens_type] = useState("");
  const [tax_liens_amount, set_tax_liens_amount] = useState<number | "">("");
  const [tax_liens_on_plan, set_tax_liens_on_plan] = useState(false);
  const [judgements_explain, set_judgements_explain] = useState("");
  const [how_soon_funds, set_how_soon_funds] = useState("");
  const [employees_count, set_employees_count] = useState<number | "">("");
  const [additional_info, set_additional_info] = useState("");
  const [documents_requested, set_documents_requested] = useState<string[]>([]);

  const toggle_document = (doc: string) => {
    set_documents_requested((prev) =>
      prev.includes(doc) ? prev.filter((d) => d !== doc) : [...prev, doc]
    );
  };

  const handle_submit = async () => {
    set_submitting(true);
    set_error("");

    try {
      const payload = {
        first_name,
        last_name,
        email,
        phone,
        company_legal_name,
        city,
        state,
        zip,
        amount_requested: Number(amount_requested),
        legal_entity_type,
        industry_1,
        industry_2: "",
        industry_3: "",
        use_of_funds,
        business_start_date,
        avg_monthly_deposits: Number(avg_monthly_deposits),
        annual_revenue: Number(annual_revenue),
        credit_score,
        sbss_score: sbss_score === "" ? null : Number(sbss_score),
        owners: [], // Empty owners array by default
        outstanding_loans: {},
        has_previous_debt,
        defaulted_on_mca,
        reduced_mca_payments,
        owns_real_estate,
        personal_cc_debt_over_75k,
        personal_cc_debt_amount: personal_cc_debt_amount === "" ? null : Number(personal_cc_debt_amount),
        foreclosures_or_bankruptcies_3y,
        bk_fc_months_ago: bk_fc_months_ago === "" ? null : Number(bk_fc_months_ago),
        bk_fc_type: bk_fc_type || null,
        tax_liens,
        tax_liens_type: tax_liens_type || null,
        tax_liens_amount: tax_liens_amount === "" ? null : Number(tax_liens_amount),
        tax_liens_on_plan,
        judgements_explain: judgements_explain || null,
        how_soon_funds: how_soon_funds || null,
        employees_count: employees_count === "" ? null : Number(employees_count),
        additional_info: additional_info || null,
        documents_requested,
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

      router.push("/auth/sign-up-success");
    } catch (err: any) {
      set_error(err.message || "Error");
    } finally {
      set_submitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50 py-12 px-4">
      <Card className="max-w-4xl mx-auto shadow-xl">
        <CardHeader className="border-b bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
          <CardTitle className="text-2xl">New Client Application</CardTitle>
          <CardDescription className="text-emerald-50">
            Complete the 3 steps. A magic link will be emailed to the client to set their password.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-8">
          {/* Progress Steps */}
          <div>
            <div className="flex items-center justify-between mb-8">
              {[
                { num: 1, label: "Contact & Business", icon: Building2 },
                { num: 2, label: "Financials", icon: DollarSign },
                { num: 3, label: "Risk & Docs", icon: FileText },
              ].map((s, idx) => (
                <div key={s.num} className="flex items-center flex-1">
                  <div className="flex flex-col items-center flex-1">
                    <div
                      className={`
                        w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm transition-all
                        ${
                          step === s.num
                            ? "bg-emerald-600 text-white ring-4 ring-emerald-100 scale-110"
                            : step > s.num
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-100 text-gray-400"
                        }
                      `}
                    >
                      {step > s.num ? <CheckCircle2 className="w-6 h-6" /> : <s.icon className="w-6 h-6" />}
                    </div>
                    <span
                      className={`
                        text-xs font-medium mt-2 text-center
                        ${step === s.num ? "text-emerald-700" : "text-gray-500"}
                      `}
                    >
                      {s.label}
                    </span>
                  </div>
                  {idx < 2 && (
                    <div
                      className={`
                        flex-1 h-1 mx-4 rounded transition-all
                        ${step > s.num ? "bg-emerald-200" : "bg-gray-200"}
                      `}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Error Display */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
                <strong className="font-semibold">Error:</strong> {error}
              </div>
            )}
</div>
            {/* STEP 1: Contact & Business */}
            {step === 1 && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="first_name" className="text-sm font-medium text-gray-700">
                      First Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="first_name"
                      value={first_name}
                      onChange={(e) => set_first_name(e.target.value)}
                      required
                      className="mt-1"
                      placeholder="John"
                    />
                  </div>

                <div>
                  <Label htmlFor="last_name" className="text-sm font-medium text-gray-700">
                    Last Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="last_name"
                    value={last_name}
                    onChange={(e) => set_last_name(e.target.value)}
                    required
                    className="mt-1"
                    placeholder="Doe"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                    Email <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => set_email(e.target.value)}
                    required
                    className="mt-1"
                    placeholder="john@example.com"
                  />
                </div>

                <div>
                  <Label htmlFor="phone" className="text-sm font-medium text-gray-700">
                    Phone <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => set_phone(e.target.value)}
                    required
                    className="mt-1"
                    placeholder="+1 (555) 123-4567"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="company_legal_name" className="text-sm font-medium text-gray-700">
                  Company Legal Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="company_legal_name"
                  value={company_legal_name}
                  onChange={(e) => set_company_legal_name(e.target.value)}
                  required
                  className="mt-1"
                  placeholder="Acme Corp LLC"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="city" className="text-sm font-medium text-gray-700">
                    City <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="city"
                    value={city}
                    onChange={(e) => set_city(e.target.value)}
                    required
                    className="mt-1"
                    placeholder="New York"
                  />
                </div>

                <div>
                  <Label htmlFor="state" className="text-sm font-medium text-gray-700">
                    State <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="state"
                    value={state}
                    onChange={(e) => set_state(e.target.value)}
                    required
                    className="mt-1"
                    placeholder="NY"
                  />
                </div>

                <div>
                  <Label htmlFor="zip" className="text-sm font-medium text-gray-700">
                    ZIP Code <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="zip"
                    value={zip}
                    onChange={(e) => set_zip(e.target.value)}
                    required
                    className="mt-1"
                    placeholder="10001"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="amount_requested" className="text-sm font-medium text-gray-700">
                    Funding Amount Requested <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="amount_requested"
                    type="number"
                    value={amount_requested}
                    onChange={(e) => set_amount_requested(e.target.value ? Number(e.target.value) : "")}
                    required
                    className="mt-1"
                    placeholder="50000"
                  />
                </div>

                <div>
                  <Label htmlFor="legal_entity_type" className="text-sm font-medium text-gray-700">
                    Entity Type <span className="text-red-500">*</span>
                  </Label>
                  <Select value={legal_entity_type} onValueChange={set_legal_entity_type}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select entity type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LLC">LLC</SelectItem>
                      <SelectItem value="Corporation">Corporation</SelectItem>
                      <SelectItem value="Sole Proprietorship">Sole Proprietorship</SelectItem>
                      <SelectItem value="Partnership">Partnership</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

    <div>
      <Label htmlFor="industry_1" className="text-sm font-medium text-gray-700">
        Industry
      </Label>
      <Input
        id="industry_1"
        value={industry_1}
        onChange={(e) => set_industry_1(e.target.value)}
        className="mt-1"
        placeholder="e.g., Retail, Healthcare, Technology"
      />
    </div>
    <div>
      <Label htmlFor="use_of_funds" className="text-sm font-medium text-gray-700">
        Use of Funds <span className="text-red-500">*</span>
      </Label>
      <Textarea
        id="use_of_funds"
        value={use_of_funds}
        onChange={(e) => set_use_of_funds(e.target.value)}
        required
        className="mt-1"
        placeholder="Describe how you plan to use the funds..."
        rows={3}
      />
    </div>
    <div className="flex justify-end">
      <Button
        onClick={() => set_step(2)}
        className="bg-emerald-600 hover:bg-emerald-700"
      >
        Next Step
        <ChevronRight className="ml-2 w-4 h-4" />
      </Button>
    </div>
  </div>
)}

      {/* STEP 2: Financials */}
      {step === 2 && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div>
            <Label htmlFor="business_start_date" className="text-sm font-medium text-gray-700">
              Business Start Date <span className="text-red-500">*</span>
            </Label>
            <Input
              id="business_start_date"
              type="date"
              value={business_start_date}
              onChange={(e) => set_business_start_date(e.target.value)}
              required
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="avg_monthly_deposits" className="text-sm font-medium text-gray-700">
                Average Monthly Deposits <span className="text-red-500">*</span>
              </Label>
              <Input
                id="avg_monthly_deposits"
                type="number"
                value={avg_monthly_deposits}
                onChange={(e) => set_avg_monthly_deposits(e.target.value ? Number(e.target.value) : "")}
                required
                className="mt-1"
                placeholder="25000"
              />
            </div>

            <div>
              <Label htmlFor="annual_revenue" className="text-sm font-medium text-gray-700">
                Annual Revenue <span className="text-red-500">*</span>
              </Label>
              <Input
                id="annual_revenue"
                type="number"
                value={annual_revenue}
                onChange={(e) => set_annual_revenue(e.target.value ? Number(e.target.value) : "")}
                required
                className="mt-1"
                placeholder="300000"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="credit_score" className="text-sm font-medium text-gray-700">
                Credit Score Range <span className="text-red-500">*</span>
              </Label>
              <Select value={credit_score} onValueChange={set_credit_score}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select credit score range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="750+">750+ (Excellent)</SelectItem>
                  <SelectItem value="700-749">700-749 (Good)</SelectItem>
                  <SelectItem value="650-699">650-699 (Fair)</SelectItem>
                  <SelectItem value="600-649">600-649 (Poor)</SelectItem>
                  <SelectItem value="Below 600">Below 600</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="sbss_score" className="text-sm font-medium text-gray-700">
                SBSS Score (Optional)
              </Label>
              <Input
                id="sbss_score"
                type="number"
                value={sbss_score}
                onChange={(e) => set_sbss_score(e.target.value ? Number(e.target.value) : "")}
                className="mt-1"
                placeholder="e.g., 160"
              />
            </div>
          </div>

          <div className="flex justify-between">
            <Button
              onClick={() => set_step(1)}
              variant="outline"
              className="border-emerald-600 text-emerald-600 hover:bg-emerald-50"
            >
              <ChevronLeft className="mr-2 w-4 h-4" />
              Previous
            </Button>
            <Button
              onClick={() => set_step(3)}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              Next Step
              <ChevronRight className="ml-2 w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: Risk & Docs */}
      {step === 3 && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-blue-900 mb-3">Risk Assessment</h3>
            <div className="space-y-3">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="has_previous_debt"
                  checked={has_previous_debt}
                  onCheckedChange={(checked) => set_has_previous_debt(checked as boolean)}
                  className="mt-1"
                />
                <Label htmlFor="has_previous_debt" className="text-sm text-gray-700 cursor-pointer">
                  Has previous debt
                </Label>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="defaulted_on_mca"
                  checked={defaulted_on_mca}
                  onCheckedChange={(checked) => set_defaulted_on_mca(checked as boolean)}
                  className="mt-1"
                />
                <Label htmlFor="defaulted_on_mca" className="text-sm text-gray-700 cursor-pointer">
                  Defaulted on MCA
                </Label>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="reduced_mca_payments"
                  checked={reduced_mca_payments}
                  onCheckedChange={(checked) => set_reduced_mca_payments(checked as boolean)}
                  className="mt-1"
                />
                <Label htmlFor="reduced_mca_payments" className="text-sm text-gray-700 cursor-pointer">
                  Reduced MCA payments
                </Label>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="owns_real_estate"
                  checked={owns_real_estate}
                  onCheckedChange={(checked) => set_owns_real_estate(checked as boolean)}
                  className="mt-1"
                />
                <Label htmlFor="owns_real_estate" className="text-sm text-gray-700 cursor-pointer">
                  Owns real estate
                </Label>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="personal_cc_debt_over_75k"
                  checked={personal_cc_debt_over_75k}
                  onCheckedChange={(checked) => set_personal_cc_debt_over_75k(checked as boolean)}
                  className="mt-1"
                />
                <Label htmlFor="personal_cc_debt_over_75k" className="text-sm text-gray-700 cursor-pointer">
                  Personal CC debt over $75k
                </Label>
              </div>

              {personal_cc_debt_over_75k && (
                <div className="ml-8">
                  <Label htmlFor="personal_cc_debt_amount" className="text-sm font-medium text-gray-700">
                    Personal CC Debt Amount
                  </Label>
                  <Input
                    id="personal_cc_debt_amount"
                    type="number"
                    value={personal_cc_debt_amount}
                    onChange={(e) => set_personal_cc_debt_amount(e.target.value ? Number(e.target.value) : "")}
                    className="mt-1"
                    placeholder="Amount"
                  />
                </div>
              )}

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="foreclosures_or_bankruptcies_3y"
                  checked={foreclosures_or_bankruptcies_3y}
                  onCheckedChange={(checked) => set_foreclosures_or_bankruptcies_3y(checked as boolean)}
                  className="mt-1"
                />
                <Label htmlFor="foreclosures_or_bankruptcies_3y" className="text-sm text-gray-700 cursor-pointer">
                  Foreclosures or bankruptcies in past 3 years
                </Label>
              </div>

              {foreclosures_or_bankruptcies_3y && (
                <div className="ml-8 space-y-3">
                  <div>
                    <Label htmlFor="bk_fc_months_ago" className="text-sm font-medium text-gray-700">
                      How many months ago?
                    </Label>
                    <Input
                      id="bk_fc_months_ago"
                      type="number"
                      value={bk_fc_months_ago}
                      onChange={(e) => set_bk_fc_months_ago(e.target.value ? Number(e.target.value) : "")}
                      className="mt-1"
                      placeholder="Months"
                    />
                  </div>
                  <div>
                    <Label htmlFor="bk_fc_type" className="text-sm font-medium text-gray-700">
                      Type
                    </Label>
                    <Select value={bk_fc_type} onValueChange={set_bk_fc_type}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="foreclosure">Foreclosure</SelectItem>
                        <SelectItem value="bankruptcy">Bankruptcy</SelectItem>
                        <SelectItem value="both">Both</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="tax_liens"
                  checked={tax_liens}
                  onCheckedChange={(checked) => set_tax_liens(checked as boolean)}
                  className="mt-1"
                />
                <Label htmlFor="tax_liens" className="text-sm text-gray-700 cursor-pointer">
                  Tax liens
                </Label>
              </div>

              {tax_liens && (
                <div className="ml-8 space-y-3">
                  <div>
                    <Label htmlFor="tax_liens_type" className="text-sm font-medium text-gray-700">
                      Tax lien type
                    </Label>
                    <Select value={tax_liens_type} onValueChange={set_tax_liens_type}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="personal">Personal</SelectItem>
                        <SelectItem value="business">Business</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="tax_liens_amount" className="text-sm font-medium text-gray-700">
                      Tax lien amount
                    </Label>
                    <Input
                      id="tax_liens_amount"
                      type="number"
                      value={tax_liens_amount}
                      onChange={(e) => set_tax_liens_amount(e.target.value ? Number(e.target.value) : "")}
                      className="mt-1"
                      placeholder="Amount"
                    />
                  </div>
                  <div className="flex items-start space-x-3">
                    <Checkbox
                      id="tax_liens_on_plan"
                      checked={tax_liens_on_plan}
                      onCheckedChange={(checked) => set_tax_liens_on_plan(checked as boolean)}
                      className="mt-1"
                    />
                    <Label htmlFor="tax_liens_on_plan" className="text-sm text-gray-700 cursor-pointer">
                      On payment plan
                    </Label>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="judgements_explain" className="text-sm font-medium text-gray-700">
              Judgements — explain (if any)
            </Label>
            <Textarea
              id="judgements_explain"
              value={judgements_explain}
              onChange={(e) => set_judgements_explain(e.target.value)}
              className="mt-1"
              placeholder="Explain any judgements..."
              rows={2}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="how_soon_funds" className="text-sm font-medium text-gray-700">
                How soon do they need funds?
              </Label>
              <Select value={how_soon_funds} onValueChange={set_how_soon_funds}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select timeframe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ASAP">ASAP</SelectItem>
                  <SelectItem value="1-2 weeks">1-2 weeks</SelectItem>
                  <SelectItem value="2-4 weeks">2-4 weeks</SelectItem>
                  <SelectItem value="1+ months">1+ months</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="employees_count" className="text-sm font-medium text-gray-700">
                Number of Employees
              </Label>
              <Input
                id="employees_count"
                type="number"
                value={employees_count}
                onChange={(e) => set_employees_count(e.target.value ? Number(e.target.value) : "")}
                className="mt-1"
                placeholder="5"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="additional_info" className="text-sm font-medium text-gray-700">
              Additional Information
            </Label>
            <Textarea
              id="additional_info"
              value={additional_info}
              onChange={(e) => set_additional_info(e.target.value)}
              className="mt-1"
              placeholder="Any additional information about the business..."
              rows={3}
            />
          </div>

          <div>
            <Label className="text-sm font-medium text-gray-700 mb-3 block">
              Documents Requested
            </Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-gray-50 p-4 rounded-lg border">
              {DOC_OPTIONS.map((doc) => (
                <div key={doc} className="flex items-start space-x-3">
                  <Checkbox
                    id={`doc-${doc}`}
                    checked={documents_requested.includes(doc)}
                    onCheckedChange={() => toggle_document(doc)}
                    className="mt-1"
                  />
                  <Label
                    htmlFor={`doc-${doc}`}
                    className="text-sm text-gray-700 cursor-pointer leading-tight"
                  >
                    {doc}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between pt-4 border-t">
            <Button
              onClick={() => set_step(2)}
              variant="outline"
              className="border-emerald-600 text-emerald-600 hover:bg-emerald-50"
            >
              <ChevronLeft className="mr-2 w-4 h-4" />
              Previous
            </Button>
            <Button
              onClick={handle_submit}
              disabled={submitting}
              className="bg-emerald-600 hover:bg-emerald-700 px-8"
            >
              {submitting ? "Creating Client..." : "Create Client & Send Magic Link"}
            </Button>
          </div>
        </div>
      )}
    </CardContent>
      </Card>
    </div>
  );
}