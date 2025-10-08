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
import { 
  ChevronRight, 
  ChevronLeft, 
  Building2, 
  DollarSign, 
  FileText, 
  CheckCircle2,
  Sparkles,
  TrendingUp,
  Shield
} from "lucide-react";

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

  // STEP 1
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

  // STEP 2
  const [business_start_date, set_business_start_date] = useState("");
  const [avg_monthly_deposits, set_avg_monthly_deposits] = useState<number | "">("");
  const [annual_revenue, set_annual_revenue] = useState<number | "">("");
  const [credit_score, set_credit_score] = useState("");
  const [sbss_score, set_sbss_score] = useState<number | "">("");

  // STEP 3
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
        owners: [],
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

      router.push(`/auth/sign-up-success?email=${encodeURIComponent(email)}`);
    } catch (err: any) {
      set_error(err.message || "Error");
    } finally {
      set_submitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
      {/* Container with proper responsive behavior */}
      <div className="w-full px-4 py-8 md:py-12">
        {/* Header Banner */}
        <div className="mb-6 md:mb-8">
          <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-6 md:p-8 text-white shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <Sparkles className="w-6 h-6 md:w-8 md:h-8" />
              <h1 className="text-2xl md:text-3xl font-bold">Welcome to Credit Banc Vault</h1>
            </div>
            <p className="text-emerald-50 text-base md:text-lg">
              Complete your application in 3 simple steps and get instant access to your funding dashboard
            </p>
            <div className="mt-4 md:mt-6 flex flex-wrap gap-3 md:gap-4">
              <div className="flex items-center gap-2 bg-white/20 rounded-lg px-3 md:px-4 py-2">
                <TrendingUp className="w-4 h-4 md:w-5 md:h-5" />
                <span className="text-xs md:text-sm font-medium">Fast Approval</span>
              </div>
              <div className="flex items-center gap-2 bg-white/20 rounded-lg px-3 md:px-4 py-2">
                <Shield className="w-4 h-4 md:w-5 md:h-5" />
                <span className="text-xs md:text-sm font-medium">Secure Platform</span>
              </div>
            </div>
          </div>
        </div>

        {/* Form Card - No max-width constraint */}
        <Card className="shadow-2xl border-0">
          <CardHeader className="border-b bg-gradient-to-r from-gray-50 to-gray-100 p-4 md:p-6">
            <CardTitle className="text-xl md:text-2xl text-gray-800">New Client Application</CardTitle>
            <CardDescription className="text-sm md:text-base text-gray-600">
              Fill out your information below. You'll receive login credentials immediately after submission.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-4 md:p-8 lg:p-10">
            {/* Progress Steps */}
            <div className="flex items-center justify-between mb-8 md:mb-10 max-w-3xl mx-auto">
              {[
                { num: 1, label: "Contact & Business", icon: Building2 },
                { num: 2, label: "Financials", icon: DollarSign },
                { num: 3, label: "Risk & Docs", icon: FileText },
              ].map((s, idx) => (
                <div key={s.num} className="flex items-center flex-1">
                  <div className="flex flex-col items-center flex-1">
                    <div
                      className={`
                        w-10 h-10 md:w-14 md:h-14 rounded-full flex items-center justify-center font-bold text-sm transition-all shadow-lg
                        ${
                          step === s.num
                            ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white ring-4 ring-emerald-100 scale-110"
                            : step > s.num
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-100 text-gray-400"
                        }
                      `}
                    >
                      {step > s.num ? (
                        <CheckCircle2 className="w-5 h-5 md:w-7 md:h-7" />
                      ) : (
                        <s.icon className="w-5 h-5 md:w-7 md:h-7" />
                      )}
                    </div>
                    <span
                      className={`
                        text-[10px] md:text-xs font-semibold mt-2 md:mt-3 text-center max-w-[80px] md:max-w-[100px]
                        ${step === s.num ? "text-emerald-700" : "text-gray-500"}
                      `}
                    >
                      {s.label}
                    </span>
                  </div>
                  {idx < 2 && (
                    <div
                      className={`
                        flex-1 h-1 md:h-1.5 mx-2 md:mx-4 rounded-full transition-all
                        ${step > s.num ? "bg-emerald-400" : "bg-gray-200"}
                      `}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Error Display */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg max-w-4xl mx-auto">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <p className="text-red-800 text-sm font-medium">{error}</p>
                </div>
              </div>
            )}

            {/* Form Content with max-width for better readability */}
            <div className="w-full">
              {/* STEP 1: Contact & Business */}
              {step === 1 && (
                <div className="space-y-6 animate-in fade-in duration-300">
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 md:p-5 mb-6">
                    <h3 className="text-sm md:text-base font-bold text-blue-900 flex items-center gap-2 mb-2">
                      <Building2 className="w-5 h-5" />
                      Contact Information
                    </h3>
                    <p className="text-xs md:text-sm text-blue-700">
                      Let's start with your basic contact details
                    </p>
                  </div>

                  {/* 2-column grid on medium screens and up */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div>
                      <Label htmlFor="first_name" className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                        First Name <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="first_name"
                        value={first_name}
                        onChange={(e) => set_first_name(e.target.value)}
                        required
                        className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                        placeholder="John"
                      />
                    </div>

                    <div>
                      <Label htmlFor="last_name" className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                        Last Name <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="last_name"
                        value={last_name}
                        onChange={(e) => set_last_name(e.target.value)}
                        required
                        className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                        placeholder="Doe"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div>
                      <Label htmlFor="email" className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                        Email <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => set_email(e.target.value)}
                        required
                        className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                        placeholder="john@company.com"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        You'll receive login credentials here
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="phone" className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                        Phone <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => set_phone(e.target.value)}
                        required
                        className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                        placeholder="(555) 123-4567"
                      />
                    </div>
                  </div>

                  <div className="h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent my-6 md:my-8"></div>

                  <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-xl p-4 md:p-5 mb-6">
                    <h3 className="text-sm md:text-base font-bold text-purple-900 flex items-center gap-2 mb-2">
                      <Building2 className="w-5 h-5" />
                      Business Details
                    </h3>
                    <p className="text-xs md:text-sm text-purple-700">
                      Tell us about your business
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="company_legal_name" className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                      Company Legal Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="company_legal_name"
                      value={company_legal_name}
                      onChange={(e) => set_company_legal_name(e.target.value)}
                      required
                      className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                      placeholder="Acme Corp LLC"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
                    <div>
                      <Label htmlFor="city" className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                        City <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="city"
                        value={city}
                        onChange={(e) => set_city(e.target.value)}
                        required
                        className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                        placeholder="New York"
                      />
                    </div>

                    <div>
                      <Label htmlFor="state" className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                        State <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="state"
                        value={state}
                        onChange={(e) => set_state(e.target.value)}
                        required
                        className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                        placeholder="NY"
                      />
                    </div>

                    <div>
                      <Label htmlFor="zip" className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                        ZIP Code <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="zip"
                        value={zip}
                        onChange={(e) => set_zip(e.target.value)}
                        required
                        className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                        placeholder="10001"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div>
                      <Label htmlFor="amount_requested" className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                        Funding Amount Requested <span className="text-red-500">*</span>
                      </Label>
                      <div className="relative mt-2">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                        <Input
                          id="amount_requested"
                          type="number"
                          value={amount_requested}
                          onChange={(e) => set_amount_requested(e.target.value ? Number(e.target.value) : "")}
                          required
                          className="pl-7 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                          placeholder="50,000"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="legal_entity_type" className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                        Entity Type <span className="text-red-500">*</span>
                      </Label>
                      <Select value={legal_entity_type} onValueChange={set_legal_entity_type}>
                        <SelectTrigger className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500">
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
                    <Label htmlFor="industry_1" className="text-sm font-semibold text-gray-700">
                      Industry
                    </Label>
                    <Input
                      id="industry_1"
                      value={industry_1}
                      onChange={(e) => set_industry_1(e.target.value)}
                      className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                      placeholder="e.g., Retail, Healthcare, Technology"
                    />
                  </div>

                  <div>
                    <Label htmlFor="use_of_funds" className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                      Use of Funds <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                      id="use_of_funds"
                      value={use_of_funds}
                      onChange={(e) => set_use_of_funds(e.target.value)}
                      required
                      className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                      placeholder="Describe how you plan to use the funds..."
                      rows={4}
                    />
                  </div>

                  <div className="flex justify-end pt-6">
                    <Button
                      onClick={() => set_step(2)}
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-6 md:px-8 py-5 md:py-6 text-sm md:text-base shadow-lg"
                    >
                      Next Step
                      <ChevronRight className="ml-2 w-4 h-4 md:w-5 md:h-5" />
                    </Button>
                  </div>
                </div>
              )}

              {/* STEP 2: Financials */}
              {step === 2 && (
                <div className="space-y-6 animate-in fade-in duration-300">
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-4 md:p-5 mb-6">
                    <h3 className="text-sm md:text-base font-bold text-green-900 flex items-center gap-2 mb-2">
                      <DollarSign className="w-5 h-5" />
                      Financial Information
                    </h3>
                    <p className="text-xs md:text-sm text-green-700">
                      Help us understand your business finances
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="business_start_date" className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                      Business Start Date <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="business_start_date"
                      type="date"
                      value={business_start_date}
                      onChange={(e) => set_business_start_date(e.target.value)}
                      required
                      className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div>
                      <Label htmlFor="avg_monthly_deposits" className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                        Average Monthly Deposits <span className="text-red-500">*</span>
                      </Label>
                      <div className="relative mt-2">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                        <Input
                          id="avg_monthly_deposits"
                          type="number"
                          value={avg_monthly_deposits}
                          onChange={(e) => set_avg_monthly_deposits(e.target.value ? Number(e.target.value) : "")}
                          required
                          className="pl-7 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                          placeholder="25,000"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="annual_revenue" className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                        Annual Revenue <span className="text-red-500">*</span>
                      </Label>
                      <div className="relative mt-2">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                        <Input
                          id="annual_revenue"
                          type="number"
                          value={annual_revenue}
                          onChange={(e) => set_annual_revenue(e.target.value ? Number(e.target.value) : "")}
                          required
                          className="pl-7 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                          placeholder="300,000"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div>
                      <Label htmlFor="credit_score" className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                        Credit Score Range <span className="text-red-500">*</span>
                      </Label>
                      <Select value={credit_score} onValueChange={set_credit_score}>
                        <SelectTrigger className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500">
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
                      <Label htmlFor="sbss_score" className="text-sm font-semibold text-gray-700">
                        SBSS Score (Optional)
                      </Label>
                      <Input
                        id="sbss_score"
                        type="number"
                        value={sbss_score}
                        onChange={(e) => set_sbss_score(e.target.value ? Number(e.target.value) : "")}
                        className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                        placeholder="e.g., 160"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Small Business Scoring Service score
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row justify-between gap-4 pt-6">
                    <Button
                      onClick={() => set_step(1)}
                      variant="outline"
                      className="border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50 px-6 md:px-8 py-5 md:py-6 text-sm md:text-base"
                    >
                      <ChevronLeft className="mr-2 w-4 h-4 md:w-5 md:h-5" />
                      Previous
                    </Button>
                    <Button
                      onClick={() => set_step(3)}
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-6 md:px-8 py-5 md:py-6 text-sm md:text-base shadow-lg"
                    >
                      Next Step
                      <ChevronRight className="ml-2 w-4 h-4 md:w-5 md:h-5" />
                    </Button>
                  </div>
                </div>
              )}

              {/* STEP 3: Risk & Docs */}
              {step === 3 && (
                <div className="space-y-6 animate-in fade-in duration-300">
                  <div className="bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-200 rounded-xl p-4 md:p-5 mb-6">
                    <h3 className="text-sm md:textRetryMContinuebase font-bold text-orange-900 flex items-center gap-2 mb-2">
<Shield className="w-5 h-5" />
Risk Assessment & Documentation
</h3>
<p className="text-xs md:text-sm text-orange-700">
Final details to complete your application
</p>
</div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 md:p-6">
                <h3 className="text-sm font-bold text-blue-900 mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Risk Assessment Questions
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors">
                    <Checkbox
                      id="has_previous_debt"
                      checked={has_previous_debt}
                      onCheckedChange={(checked) => set_has_previous_debt(checked as boolean)}
                      className="mt-1 border-blue-300"
                    />
                    <Label htmlFor="has_previous_debt" className="text-sm text-gray-700 cursor-pointer leading-relaxed">
                      Has previous debt
                    </Label>
                  </div>

                  <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors">
                    <Checkbox
                      id="defaulted_on_mca"
                      checked={defaulted_on_mca}
                      onCheckedChange={(checked) => set_defaulted_on_mca(checked as boolean)}
                      className="mt-1 border-blue-300"
                    />
                    <Label htmlFor="defaulted_on_mca" className="text-sm text-gray-700 cursor-pointer leading-relaxed">
                      Defaulted on MCA
                    </Label>
                  </div>

                  <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors">
                    <Checkbox
                      id="reduced_mca_payments"
                      checked={reduced_mca_payments}
                      onCheckedChange={(checked) => set_reduced_mca_payments(checked as boolean)}
                      className="mt-1 border-blue-300"
                    />
                    <Label htmlFor="reduced_mca_payments" className="text-sm text-gray-700 cursor-pointer leading-relaxed">
                      Reduced MCA payments
                    </Label>
                  </div>

                  <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors">
                    <Checkbox
                      id="owns_real_estate"
                      checked={owns_real_estate}
                      onCheckedChange={(checked) => set_owns_real_estate(checked as boolean)}
                      className="mt-1 border-blue-300"
                    />
                    <Label htmlFor="owns_real_estate" className="text-sm text-gray-700 cursor-pointer leading-relaxed">
                      Owns real estate
                    </Label>
                  </div>

                  <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors col-span-1 md:col-span-2">
                    <Checkbox
                      id="personal_cc_debt_over_75k"
                      checked={personal_cc_debt_over_75k}
                      onCheckedChange={(checked) => set_personal_cc_debt_over_75k(checked as boolean)}
                      className="mt-1 border-blue-300"
                    />
                    <Label htmlFor="personal_cc_debt_over_75k" className="text-sm text-gray-700 cursor-pointer leading-relaxed">
                      Personal CC debt over $75k
                    </Label>
                  </div>
                </div>

                {personal_cc_debt_over_75k && (
                  <div className="mt-4 p-4 bg-white rounded-lg border border-blue-200">
                    <Label htmlFor="personal_cc_debt_amount" className="text-sm font-semibold text-gray-700">
                      Personal CC Debt Amount
                    </Label>
                    <div className="relative mt-2">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                      <Input
                        id="personal_cc_debt_amount"
                        type="number"
                        value={personal_cc_debt_amount}
                        onChange={(e) => set_personal_cc_debt_amount(e.target.value ? Number(e.target.value) : "")}
                        className="pl-7 border-gray-300"
                        placeholder="Amount"
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                  <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors col-span-1 md:col-span-2">
                    <Checkbox
                      id="foreclosures_or_bankruptcies_3y"
                      checked={foreclosures_or_bankruptcies_3y}
                      onCheckedChange={(checked) => set_foreclosures_or_bankruptcies_3y(checked as boolean)}
                      className="mt-1 border-blue-300"
                    />
                    <Label htmlFor="foreclosures_or_bankruptcies_3y" className="text-sm text-gray-700 cursor-pointer leading-relaxed">
                      Foreclosures or bankruptcies in past 3 years
                    </Label>
                  </div>
                </div>

                {foreclosures_or_bankruptcies_3y && (
                  <div className="mt-4 p-4 bg-white rounded-lg border border-blue-200 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="bk_fc_months_ago" className="text-sm font-semibold text-gray-700">
                          How many months ago?
                        </Label>
                        <Input
                          id="bk_fc_months_ago"
                          type="number"
                          value={bk_fc_months_ago}
                          onChange={(e) => set_bk_fc_months_ago(e.target.value ? Number(e.target.value) : "")}
                          className="mt-2 border-gray-300"
                          placeholder="Months"
                        />
                      </div>
                      <div>
                        <Label htmlFor="bk_fc_type" className="text-sm font-semibold text-gray-700">
                          Type
                        </Label>
                        <Select value={bk_fc_type} onValueChange={set_bk_fc_type}>
                          <SelectTrigger className="mt-2 border-gray-300">
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
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                  <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors col-span-1 md:col-span-2">
                    <Checkbox
                      id="tax_liens"
                      checked={tax_liens}
                      onCheckedChange={(checked) => set_tax_liens(checked as boolean)}
                      className="mt-1 border-blue-300"
                    />
                    <Label htmlFor="tax_liens" className="text-sm text-gray-700 cursor-pointer leading-relaxed">
                      Tax liens
                    </Label>
                  </div>
                </div>

                {tax_liens && (
                  <div className="mt-4 p-4 bg-white rounded-lg border border-blue-200 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="tax_liens_type" className="text-sm font-semibold text-gray-700">
                          Tax lien type
                        </Label>
                        <Select value={tax_liens_type} onValueChange={set_tax_liens_type}>
                          <SelectTrigger className="mt-2 border-gray-300">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="personal">Personal</SelectItem>
                            <SelectItem value="business">Business</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="tax_liens_amount" className="text-sm font-semibold text-gray-700">
                          Tax lien amount
                        </Label>
                        <div className="relative mt-2">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                          <Input
                            id="tax_liens_amount"
                            type="number"
                            value={tax_liens_amount}
                            onChange={(e) => set_tax_liens_amount(e.target.value ? Number(e.target.value) : "")}
                            className="pl-7 border-gray-300"
                            placeholder="Amount"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start space-x-3 p-3 hover:bg-gray-50 rounded-lg transition-colors">
                      <Checkbox
                        id="tax_liens_on_plan"
                        checked={tax_liens_on_plan}
                        onCheckedChange={(checked) => set_tax_liens_on_plan(checked as boolean)}
                        className="mt-1"
                      />
                      <Label htmlFor="tax_liens_on_plan" className="text-sm text-gray-700 cursor-pointer leading-relaxed">
                        On payment plan
                      </Label>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <Label htmlFor="judgements_explain" className="text-sm font-semibold text-gray-700">
                  Judgements — explain (if any)
                </Label>
                <Textarea
                  id="judgements_explain"
                  value={judgements_explain}
                  onChange={(e) => set_judgements_explain(e.target.value)}
                  className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder="Explain any judgements..."
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <div>
                  <Label htmlFor="how_soon_funds" className="text-sm font-semibold text-gray-700">
                    How soon do they need funds?
                  </Label>
                  <Select value={how_soon_funds} onValueChange={set_how_soon_funds}>
                    <SelectTrigger className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500">
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
                  <Label htmlFor="employees_count" className="text-sm font-semibold text-gray-700">
                    Number of Employees
                  </Label>
                  <Input
                    id="employees_count"
                    type="number"
                    value={employees_count}
                    onChange={(e) => set_employees_count(e.target.value ? Number(e.target.value) : "")}
                    className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                    placeholder="5"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="additional_info" className="text-sm font-semibold text-gray-700">
                  Additional Information
                </Label>
                <Textarea
                  id="additional_info"
                  value={additional_info}
                  onChange={(e) => set_additional_info(e.target.value)}
                  className="mt-2 border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder="Any additional information about the business..."
                  rows={4}
                />
              </div>

              <div>
                <Label className="text-sm font-semibold text-gray-700 mb-4 block">
                  Documents Requested
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-gray-50 p-4 md:p-6 rounded-xl border-2 border-gray-200">
                  {DOC_OPTIONS.map((doc) => (
                    <div key={doc} className="flex items-start space-x-3 p-3 hover:bg-white rounded-lg transition-colors">
                      <Checkbox
                        id={`doc-${doc}`}
                        checked={documents_requested.includes(doc)}
                        onCheckedChange={() => toggle_document(doc)}
                        className="mt-1"
                      />
                      <Label
                        htmlFor={`doc-${doc}`}
                        className="text-sm text-gray-700 cursor-pointer leading-tight font-medium"
                      >
                        {doc}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row justify-between gap-4 pt-8 border-t-2 border-gray-200">
                <Button
                  onClick={() => set_step(2)}
                  variant="outline"
                  className="border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50 px-6 md:px-8 py-5 md:py-6 text-sm md:text-base"
                >
                  <ChevronLeft className="mr-2 w-4 h-4 md:w-5 md:h-5" />
                  Previous
                </Button>
                <Button
                  onClick={handle_submit}
                  disabled={submitting}
                  className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-8 md:px-12 py-5 md:py-6 text-sm md:text-base shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                      Creating Account...
                    </>
                  ) : (
                    <>
                      Complete & Get Access
                      <CheckCircle2 className="ml-2 w-4 h-4 md:w-5 md:h-5" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  </div>
</div>
);
}