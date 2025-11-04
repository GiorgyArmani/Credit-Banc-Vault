"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 
  ChevronRight, 
  ChevronLeft, 
  Building2, 
  DollarSign, 
  FileText, 
  CheckCircle2,
  Sparkles,
  TrendingUp,
  Shield,
  MapPin,
  Users,
  CreditCard,
  Clock
} from "lucide-react";


// Estados de EE.UU.
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

// Credit score options - these values MUST match exactly with GHL field values
// GHL field name: "[Data Vault] What Is Their Credit Score?"
const CREDIT_SCORE_OPTIONS = [
  { value: '700+', label: '700+' },
  { value: '650-700', label: '650-700' },
  { value: '600-650', label: '600-650' },
  { value: '550-600', label: '550-600' },
  { value: 'Below 550', label: 'Below 550' },
];

// Tipos de préstamo
const LOAN_TYPES = [
  'Line of Credit',
  'MCA',
  'SBA Loan',
  'Personal Term Loan',
  'Real Estate Loan',
  'AR Loan',
  'Other'
];

// Tipos de entidad legal
const LEGAL_ENTITY_TYPES = [
  'LLC',
  'C-Corp',
  'S-Corp',
  'Sole Prop',
  'Other'
];

// Urgencia para obtener fondos
const FUNDING_URGENCY = [
  'Immediately',
  '1–3 Weeks',
  '3 Weeks +'
];

// Document options for tracking requested documents
// Each document will generate a GHL tag: "requested_{doc_name}"
// When uploaded, tag changes to: "submitted_{doc_name}"
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

// Types
type Advisor = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  profile_pic_url: string | null;
};

// Interface for outstanding loans structure - used to track existing debt information
interface OutstandingLoans {
  loan1: {
    balance: number | "";
    lender_name: string;
    term: string;
  };
  loan2: {
    balance: number | "";
    lender_name: string;
    term: string;
  };
  loan3: {
    balance: number | "";
    lender_name: string;
    term: string;
  };
}

export default function ClientSignupFormHybrid() {
  const router = useRouter();
  const supabase = createClient();
  const [step, set_step] = useState(1);
  const [submitting, set_submitting] = useState(false);
  const [error, set_error] = useState("");

  // Advisors
  const [advisors, set_advisors] = useState<Advisor[]>([]);
  const [loading_advisors, set_loading_advisors] = useState(true);

  // ===== PASO 1: Información Básica =====
  const [client_name, set_client_name] = useState("");
  const [company_name, set_company_name] = useState("");
  const [client_phone, set_client_phone] = useState("");
  const [client_email, set_client_email] = useState("");

  // ===== PASO 2: Ubicación y Estructura =====
  const [company_state, set_company_state] = useState("");
  const [company_city, set_company_city] = useState("");
  const [company_zip_code, set_company_zip_code] = useState("");
  const [legal_entity_type, set_legal_entity_type] = useState("");
  const [business_start_date, set_business_start_date] = useState("");
  const [is_home_based, set_is_home_based] = useState(false);
  const [employees_count, set_employees_count] = useState("");

  // ===== PASO 3: Información Financiera =====
  const [capital_requested, set_capital_requested] = useState("");
  const [loan_purpose, set_loan_purpose] = useState("");
  const [proposed_loan_type, set_proposed_loan_type] = useState("");
  const [avg_monthly_deposits, set_avg_monthly_deposits] = useState("");
  const [avg_annual_revenue, set_avg_annual_revenue] = useState("");

  // ===== Existing Debt (Outstanding Loans) =====
  // This tracks whether the client has any previous debt obligations
  const [has_previous_debt, set_has_previous_debt] = useState(false);
  // State to store up to 3 outstanding loans with balance, lender name, and term
  const [outstanding_loans, set_outstanding_loans] = useState<OutstandingLoans>({
    loan1: { balance: "", lender_name: "", term: "" },
    loan2: { balance: "", lender_name: "", term: "" },
    loan3: { balance: "", lender_name: "", term: "" },
  });

  // Helper function to update individual loan fields
  const update_loan = (loan_key: keyof OutstandingLoans, field: string, value: any) => {
    set_outstanding_loans((prev) => ({
      ...prev,
      [loan_key]: {
        ...prev[loan_key],
        [field]: value,
      },
    }));
  };

  // Helper function to toggle document selection
  // Adds or removes documents from the requested list
  const toggle_document = (doc: string) => {
    set_documents_requested((prev) =>
      prev.includes(doc) ? prev.filter((d) => d !== doc) : [...prev, doc]
    );
  };

  // ===== PASO 4: Propietarios =====
  const [number_of_owners, set_number_of_owners] = useState("Just one");
  const [owner_1_name, set_owner_1_name] = useState("");
  const [owner_1_ownership_pct, set_owner_1_ownership_pct] = useState("100");
  const [owner_2_name, set_owner_2_name] = useState("");
  const [owner_2_ownership_pct, set_owner_2_ownership_pct] = useState("");
  const [owner_3_name, set_owner_3_name] = useState("");
  const [owner_3_ownership_pct, set_owner_3_ownership_pct] = useState("");
  const [owner_4_name, set_owner_4_name] = useState("");
  const [owner_4_ownership_pct, set_owner_4_ownership_pct] = useState("");
  const [owner_5_name, set_owner_5_name] = useState("");
  const [owner_5_ownership_pct, set_owner_5_ownership_pct] = useState("");

  // ===== PASO 5: Crédito y Situaciones Especiales =====
  const [credit_score, set_credit_score] = useState("");
  const [has_existing_loans, set_has_existing_loans] = useState(false);
  
  // ===== Detailed Application Flags (matching application_flags table) =====
  // These flags capture risk assessment information about the client
  
  // MCA defaults and reductions
  const [has_defaulted_mca, set_has_defaulted_mca] = useState(false);
  const [mca_was_satisfied, set_mca_was_satisfied] = useState(false);
  const [has_reduced_mca_payments, set_has_reduced_mca_payments] = useState(false);
  const [reduced_payments_months_ago, set_reduced_payments_months_ago] = useState<number | "">("");
  
  // Asset ownership
  const [owns_real_estate, set_owns_real_estate] = useState(false);
  
  // Personal credit card debt
  const [has_personal_debt_over_75k, set_has_personal_debt_over_75k] = useState(false);
  const [personal_cc_debt_amount, set_personal_cc_debt_amount] = useState<number | "">("");
  
  // Bankruptcy and foreclosure history
  const [has_bankruptcy_foreclosure_3y, set_has_bankruptcy_foreclosure_3y] = useState(false);
  const [bk_fc_months_ago, set_bk_fc_months_ago] = useState<number | "">("");
  const [bk_fc_type, set_bk_fc_type] = useState("");
  
  // Tax liens
  const [has_tax_liens, set_has_tax_liens] = useState(false);
  const [tax_liens_type, set_tax_liens_type] = useState("");
  const [tax_liens_amount, set_tax_liens_amount] = useState<number | "">("");
  const [tax_liens_on_plan, set_tax_liens_on_plan] = useState(false);
  
  // Judgements
  const [has_active_judgements, set_has_active_judgements] = useState(false);
  const [judgements_explain, set_judgements_explain] = useState("");
  
  // Zero balance letter
  const [has_zbl, set_has_zbl] = useState(false);

  // ===== PASO 6: Timeline, Notas y Advisor =====
  const [funding_eta, set_funding_eta] = useState("");
  const [additional_notes, set_additional_notes] = useState("");
  const [advisor_id, set_advisor_id] = useState("");

  // ===== Documents Requested =====
  // Tracks which documents are requested from the client
  // Each selected document will generate a "requested_{doc}" tag in GHL
  const [documents_requested, set_documents_requested] = useState<string[]>([]);

  // Fetch advisors
  useEffect(() => {
    async function fetch_advisors() {
      try {
        const { data, error } = await supabase
          .from("advisors")
          .select("id, first_name, last_name, email, phone, profile_pic_url")
          .eq("is_active", true)
          .order("first_name", { ascending: true });
        if (error) throw error;
        set_advisors(data || []);
      } catch (err: any) {
        console.error("Error fetching advisors:", err);
      } finally {
        set_loading_advisors(false);
      }
    }
    fetch_advisors();
  }, [supabase]);

  // Validación de ownership percentages
  const validate_ownership = () => {
    let total = 0;
    if (owner_1_ownership_pct) total += parseFloat(owner_1_ownership_pct);
    if (owner_2_ownership_pct) total += parseFloat(owner_2_ownership_pct);
    if (owner_3_ownership_pct) total += parseFloat(owner_3_ownership_pct);
    if (owner_4_ownership_pct) total += parseFloat(owner_4_ownership_pct);
    if (owner_5_ownership_pct) total += parseFloat(owner_5_ownership_pct);
    
    return Math.abs(total - 100) < 0.01;
  };

  // Helper function to generate GHL (Go High Level) tags based on application flags
  // These tags help categorize and flag risk factors in the CRM
  const generate_ghl_tags = () => {
    const tags: string[] = [];
    
    // Add tags based on risk flags
    if (has_defaulted_mca) tags.push("defaulted-mca");
    if (mca_was_satisfied) tags.push("mca-satisfied");
    if (has_reduced_mca_payments) tags.push("reduced-mca-payments");
    if (owns_real_estate) tags.push("owns-real-estate");
    if (has_personal_debt_over_75k) tags.push("high-personal-debt");
    if (has_bankruptcy_foreclosure_3y) tags.push("recent-bk-fc");
    if (has_tax_liens) tags.push("tax-liens");
    if (tax_liens_on_plan) tags.push("tax-lien-payment-plan");
    if (has_active_judgements) tags.push("active-judgements");
    if (has_zbl) tags.push("has-zbl");
    if (has_previous_debt) tags.push("existing-debt");
    
    // Add credit score category tag - values now match GHL exactly
    if (credit_score) {
      if (credit_score === "700+") tags.push("credit-excellent");
      else if (credit_score === "650-700") tags.push("credit-very-good");
      else if (credit_score === "600-650") tags.push("credit-good");
      else if (credit_score === "550-600") tags.push("credit-fair");
      else if (credit_score === "Below 550") tags.push("credit-poor");
    }
    
    // Add funding urgency tag
    if (funding_eta) {
      if (funding_eta === "Immediately") tags.push("urgent-funding");
      else if (funding_eta === "1–3 Weeks") tags.push("moderate-timeline");
      else tags.push("flexible-timeline");
    }
    
    // Add document request tags
    // Each requested document gets a "requested_{doc_name}" tag
    // When the document is uploaded, the tag should be changed to "submitted_{doc_name}"
    // and the "requested_" tag should be removed
    documents_requested.forEach((doc) => {
      // Convert document name to tag-friendly format
      // "Driver's License" -> "requested_drivers_license"
      // "Business Bank Statements" -> "requested_business_bank_statements"
      const tag_name = doc
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') // Remove special characters
        .replace(/\s+/g, '_')         // Replace spaces with underscores
        .replace(/_+/g, '_');         // Remove duplicate underscores
      
      tags.push(`requested_${tag_name}`);
    });
    
    return tags;
  };

  // Handle submit
  const handle_submit = async () => {
    set_submitting(true);
    set_error("");

    try {
      // Validar ownership percentages
      if (!validate_ownership()) {
        throw new Error("Ownership percentages must sum to 100%");
      }

      // Obtener nombre del advisor
      const selected_advisor = advisors.find(a => a.id === advisor_id);
      const advisor_name = selected_advisor 
        ? `${selected_advisor.first_name} ${selected_advisor.last_name}`
        : "Unknown";

      const payload = {
        // Información básica
        client_name,
        company_name,
        client_phone,
        client_email,

        // Ubicación
        company_state,
        company_city,
        company_zip_code,

        // Financiero
        capital_requested,
        loan_purpose,
        proposed_loan_type,
        avg_monthly_deposits,
        avg_annual_revenue,

        // Estructura
        legal_entity_type,
        business_start_date,
        is_home_based,
        employees_count,

        // Propietarios
        number_of_owners,
        owner_1_name,
        owner_1_ownership_pct,
        owner_2_name: owner_2_name || null,
        owner_2_ownership_pct: owner_2_ownership_pct || null,
        owner_3_name: owner_3_name || null,
        owner_3_ownership_pct: owner_3_ownership_pct || null,
        owner_4_name: owner_4_name || null,
        owner_4_ownership_pct: owner_4_ownership_pct || null,
        owner_5_name: owner_5_name || null,
        owner_5_ownership_pct: owner_5_ownership_pct || null,

        // Crédito y situaciones especiales
        credit_score,
        has_existing_loans,

        // ===== Application Flags (for application_flags table) =====
        // These flags will be saved to the application_flags table
        application_flags: {
          defaulted_on_mca: has_defaulted_mca,
          defaulted_mca_satisfied: mca_was_satisfied,
          reduced_mca_payments: has_reduced_mca_payments,
          reduced_payments_months_ago: reduced_payments_months_ago || null,
          owns_real_estate,
          personal_cc_debt_over_75k: has_personal_debt_over_75k,
          personal_cc_debt_amount: personal_cc_debt_amount || null,
          foreclosures_or_bankruptcies_3y: has_bankruptcy_foreclosure_3y,
          bk_fc_months_ago: bk_fc_months_ago || null,
          bk_fc_type: bk_fc_type || null,
          tax_liens: has_tax_liens,
          tax_liens_type: tax_liens_type || null,
          tax_liens_amount: tax_liens_amount || null,
          tax_liens_on_plan: tax_liens_on_plan,
          judgements: has_active_judgements,
          judgements_explain: judgements_explain || null,
          has_zbl,
          how_soon_funds: funding_eta,
          employees_count: employees_count ? Number(employees_count) : null,
          additional_info: additional_notes,
        },

        // ===== Outstanding Loans (existing debt) =====
        // This captures up to 3 existing loans the client may have
        outstanding_loans: has_previous_debt ? outstanding_loans : null,
        has_previous_debt,

        // Timeline y notas
        funding_eta,
        additional_notes,
        
        // Advisor
        advisor_name,
        advisor_id,

        // ===== Documents Requested =====
        // List of documents that need to be collected from the client
        documents_requested,

        // ===== GHL Tags =====
        // These tags will be sent to Go High Level for contact categorization
        ghl_tags: generate_ghl_tags(),
      };

      const res = await fetch("/api/client-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const error_data = await res.json().catch(() => ({}));
        throw new Error(error_data?.error || "Signup failed");
      }

      const result = await res.json();
      
      // Redirigir a página de éxito
      router.push(`/auth/sign-up-success?email=${encodeURIComponent(client_email)}`);
    } catch (err: any) {
      set_error(err.message || "Error submitting form");
    } finally {
      set_submitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
      <div className="w-full px-4 py-8 md:py-12">
        {/* Header Banner */}
        <div className="mb-6 md:mb-8">
          <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-6 md:p-8 text-white shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <Sparkles className="w-6 h-6 md:w-8 md:h-8" />
              <h1 className="text-2xl md:text-3xl font-bold">Welcome to Credit Banc Vault</h1>
            </div>
            <p className="text-emerald-50 text-base md:text-lg">
              Complete your application in 6 simple steps and get instant access to your funding dashboard
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

        <Card className="shadow-2xl border-0">
          <CardHeader className="border-b bg-gradient-to-r from-gray-50 to-gray-100 p-4 md:p-6">
            <CardTitle className="text-xl md:text-2xl text-gray-800">New Client Application</CardTitle>
            <CardDescription className="text-sm md:text-base text-gray-600">
              Fill out your information below. You'll receive login credentials immediately after submission.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-4 md:p-8 lg:p-10">
            {/* Progress Steps */}
            <div className="flex items-center justify-between mb-8 md:mb-10 overflow-x-auto">
              {[
                { num: 1, label: "Contact Info", icon: Building2 },
                { num: 2, label: "Location", icon: MapPin },
                { num: 3, label: "Financials", icon: DollarSign },
                { num: 4, label: "Owners", icon: Users },
                { num: 5, label: "Credit", icon: CreditCard },
                { num: 6, label: "Final Details", icon: Clock },
              ].map((s, idx) => (
                <div key={s.num} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center font-bold text-sm transition-all shadow-lg
                        ${step === s.num ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white ring-4 ring-emerald-100 scale-110" : 
                        step > s.num ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"}`}
                    >
                      {step > s.num ? <CheckCircle2 className="w-5 h-5 md:w-6 md:h-6" /> : <s.icon className="w-5 h-5 md:w-6 md:h-6" />}
                    </div>
                    <span className={`text-[10px] md:text-xs font-semibold mt-2 text-center whitespace-nowrap ${step === s.num ? "text-emerald-700" : "text-gray-500"}`}>
                      {s.label}
                    </span>
                  </div>
                  {idx < 5 && <div className={`h-1 w-8 md:w-12 mx-1 md:mx-2 rounded-full transition-all ${step > s.num ? "bg-emerald-400" : "bg-gray-200"}`} />}
                </div>
              ))}
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <p className="text-red-800 text-sm font-medium">{error}</p>
                </div>
              </div>
            )}

            <div className="w-full">
              {/* STEP 1: Contact Info */}
              {step === 1 && (
                <div className="space-y-6 animate-fade-in">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-emerald-900 mb-2">Contact Information</h3>
                    <p className="text-sm text-emerald-700">Let's start with the basic contact details</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div>
                      <Label htmlFor="client_name" className="text-sm font-semibold text-gray-700">Client Full Name *</Label>
                      <Input 
                        id="client_name" 
                        value={client_name} 
                        onChange={(e) => set_client_name(e.target.value)} 
                        className="mt-2" 
                        placeholder="John Doe"
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="company_name" className="text-sm font-semibold text-gray-700">Company Name *</Label>
                      <Input 
                        id="company_name" 
                        value={company_name} 
                        onChange={(e) => set_company_name(e.target.value)} 
                        className="mt-2" 
                        placeholder="Acme Corp LLC"
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="client_email" className="text-sm font-semibold text-gray-700">Email Address *</Label>
                      <Input 
                        id="client_email" 
                        type="email"
                        value={client_email} 
                        onChange={(e) => set_client_email(e.target.value)} 
                        className="mt-2" 
                        placeholder="john@example.com"
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="client_phone" className="text-sm font-semibold text-gray-700">Phone Number *</Label>
                      <Input 
                        id="client_phone" 
                        type="tel"
                        value={client_phone} 
                        onChange={(e) => set_client_phone(e.target.value)} 
                        className="mt-2" 
                        placeholder="(555) 123-4567"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-6">
                    <Button 
                      onClick={() => set_step(2)} 
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-8 py-6 shadow-lg"
                    >
                      Next: Location
                      <ChevronRight className="ml-2 w-5 h-5" />
                    </Button>
                  </div>
                </div>
              )}

              {/* STEP 2: Location & Structure */}
              {step === 2 && (
                <div className="space-y-6 animate-fade-in">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-blue-900 mb-2">Business Location & Structure</h3>
                    <p className="text-sm text-blue-700">Tell us about your business location and structure</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div>
                      <Label htmlFor="company_state" className="text-sm font-semibold text-gray-700">State *</Label>
                      <Select value={company_state} onValueChange={set_company_state}>
                        <SelectTrigger className="mt-2">
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                        <SelectContent>
                          {US_STATES.map((state) => (
                            <SelectItem key={state} value={state}>
                              {state}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="company_city" className="text-sm font-semibold text-gray-700">City</Label>
                      <Input 
                        id="company_city" 
                        value={company_city} 
                        onChange={(e) => set_company_city(e.target.value)} 
                        className="mt-2" 
                        placeholder="Los Angeles"
                      />
                    </div>

                    <div>
                      <Label htmlFor="company_zip_code" className="text-sm font-semibold text-gray-700">ZIP Code *</Label>
                      <Input 
                        id="company_zip_code" 
                        value={company_zip_code} 
                        onChange={(e) => set_company_zip_code(e.target.value)} 
                        className="mt-2" 
                        placeholder="90210"
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="legal_entity_type" className="text-sm font-semibold text-gray-700">Legal Entity Type *</Label>
                      <Select value={legal_entity_type} onValueChange={set_legal_entity_type}>
                        <SelectTrigger className="mt-2">
                          <SelectValue placeholder="Select entity type" />
                        </SelectTrigger>
                        <SelectContent>
                          {LEGAL_ENTITY_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="business_start_date" className="text-sm font-semibold text-gray-700">Business Start Date *</Label>
                      <Input 
                        id="business_start_date" 
                        type="date"
                        value={business_start_date} 
                        onChange={(e) => set_business_start_date(e.target.value)} 
                        className="mt-2"
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="employees_count" className="text-sm font-semibold text-gray-700">Number of Employees *</Label>
                      <Input 
                        id="employees_count" 
                        type="number"
                        value={employees_count} 
                        onChange={(e) => set_employees_count(e.target.value)} 
                        className="mt-2" 
                        placeholder="5"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex items-start space-x-3 p-4 hover:bg-gray-50 rounded-lg transition-colors">
                    <Checkbox 
                      id="is_home_based" 
                      checked={is_home_based} 
                      onCheckedChange={(checked) => set_is_home_based(checked as boolean)} 
                      className="mt-1" 
                    />
                    <Label htmlFor="is_home_based" className="text-sm text-gray-700 cursor-pointer">
                      This is a home-based business
                    </Label>
                  </div>

                  <div className="flex flex-col sm:flex-row justify-between gap-4 pt-6">
                    <Button 
                      onClick={() => set_step(1)} 
                      variant="outline" 
                      className="border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50 px-8 py-6"
                    >
                      <ChevronLeft className="mr-2 w-5 h-5" />
                      Previous
                    </Button>
                    <Button 
                      onClick={() => set_step(3)} 
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-8 py-6 shadow-lg"
                    >
                      Next: Financials
                      <ChevronRight className="ml-2 w-5 h-5" />
                    </Button>
                  </div>
                </div>
              )}

              {/* STEP 3: Financial Information */}
              {step === 3 && (
                <div className="space-y-6 animate-fade-in">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-green-900 mb-2">Financial Information</h3>
                    <p className="text-sm text-green-700">Tell us about your funding needs and revenue</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div>
                      <Label htmlFor="capital_requested" className="text-sm font-semibold text-gray-700">Capital Requested *</Label>
                      <div className="relative mt-2">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                        <Input 
                          id="capital_requested" 
                          type="number"
                          value={capital_requested} 
                          onChange={(e) => set_capital_requested(e.target.value)} 
                          className="pl-7" 
                          placeholder="50000"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="proposed_loan_type" className="text-sm font-semibold text-gray-700">Proposed Loan Type *</Label>
                      <Select value={proposed_loan_type} onValueChange={set_proposed_loan_type}>
                        <SelectTrigger className="mt-2">
                          <SelectValue placeholder="Select loan type" />
                        </SelectTrigger>
                        <SelectContent>
                          {LOAN_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="md:col-span-2">
                      <Label htmlFor="loan_purpose" className="text-sm font-semibold text-gray-700">What will the funds be used for? *</Label>
                      <Textarea 
                        id="loan_purpose" 
                        value={loan_purpose} 
                        onChange={(e) => set_loan_purpose(e.target.value)} 
                        className="mt-2" 
                        placeholder="Equipment purchase, inventory, expansion, etc."
                        rows={3}
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="avg_monthly_deposits" className="text-sm font-semibold text-gray-700">Average Monthly Deposits *</Label>
                      <div className="relative mt-2">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                        <Input 
                          id="avg_monthly_deposits" 
                          type="number"
                          value={avg_monthly_deposits} 
                          onChange={(e) => set_avg_monthly_deposits(e.target.value)} 
                          className="pl-7" 
                          placeholder="10000"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="avg_annual_revenue" className="text-sm font-semibold text-gray-700">Average Annual Revenue *</Label>
                      <div className="relative mt-2">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                        <Input 
                          id="avg_annual_revenue" 
                          type="number"
                          value={avg_annual_revenue} 
                          onChange={(e) => set_avg_annual_revenue(e.target.value)} 
                          className="pl-7" 
                          placeholder="120000"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {/* Existing Debt Section */}
                  {/* This section captures information about any outstanding loans the client currently has */}
                  <div className="space-y-4 mt-6 p-6 bg-amber-50 rounded-lg border border-amber-200">
                    <h3 className="text-lg font-semibold text-gray-900">Existing Debt</h3>
                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        id="has_previous_debt" 
                        checked={has_previous_debt} 
                        onCheckedChange={(checked) => set_has_previous_debt(checked as boolean)} 
                      />
                      <Label htmlFor="has_previous_debt" className="cursor-pointer text-gray-700">
                        Has Previous Debt
                      </Label>
                    </div>
                    
                    {/* Conditional rendering: Show loan input fields only if client has previous debt */}
                    {has_previous_debt && (
                      <div className="space-y-4 border rounded-lg p-4 bg-white">
                        {/* Iterate through 3 possible loans - Loan 1 is required, 2 and 3 are optional */}
                        {[1, 2, 3].map((num) => {
                          const loan_key = `loan${num}` as keyof OutstandingLoans;
                          return (
                            <div key={num} className="space-y-3 pb-4 border-b last:border-b-0">
                              <h4 className="font-medium text-gray-800">
                                Loan {num} {num > 1 && <span className="text-gray-500 text-sm">(Optional)</span>}
                              </h4>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {/* Balance field: captures the outstanding balance amount */}
                                <div>
                                  <Label className="text-xs text-gray-600">Balance</Label>
                                  <div className="relative mt-1">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                                    <Input 
                                      type="number" 
                                      value={outstanding_loans[loan_key]?.balance || ""} 
                                      onChange={(e) => update_loan(loan_key, "balance", Number(e.target.value))} 
                                      placeholder="Amount" 
                                      className="pl-7"
                                    />
                                  </div>
                                </div>
                                {/* Lender name field: captures who the loan is with */}
                                <div>
                                  <Label className="text-xs text-gray-600">Lender Name</Label>
                                  <Input 
                                    value={outstanding_loans[loan_key]?.lender_name || ""} 
                                    onChange={(e) => update_loan(loan_key, "lender_name", e.target.value)} 
                                    placeholder="Lender" 
                                    className="mt-1"
                                  />
                                </div>
                                {/* Term field: captures the loan term (e.g., "12 months") */}
                                <div>
                                  <Label className="text-xs text-gray-600">Term</Label>
                                  <Input 
                                    value={outstanding_loans[loan_key]?.term || ""} 
                                    onChange={(e) => update_loan(loan_key, "term", e.target.value)} 
                                    placeholder="12 months" 
                                    className="mt-1"
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row justify-between gap-4 pt-6">
                    <Button 
                      onClick={() => set_step(2)} 
                      variant="outline" 
                      className="border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50 px-8 py-6"
                    >
                      <ChevronLeft className="mr-2 w-5 h-5" />
                      Previous
                    </Button>
                    <Button 
                      onClick={() => set_step(4)} 
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-8 py-6 shadow-lg"
                    >
                      Next: Owners
                      <ChevronRight className="ml-2 w-5 h-5" />
                    </Button>
                  </div>
                </div>
              )}

              {/* STEP 4: Business Owners */}
              {step === 4 && (
                <div className="space-y-6 animate-fade-in">
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-purple-900 mb-2">Business Ownership</h3>
                    <p className="text-sm text-purple-700">List all owners and their ownership percentages (must total 100%)</p>
                  </div>

                  <div>
                    <Label htmlFor="number_of_owners" className="text-sm font-semibold text-gray-700 mb-3 block">How many owners? *</Label>
                    <Select value={number_of_owners} onValueChange={set_number_of_owners}>
                      <SelectTrigger className="max-w-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Just one">Just one</SelectItem>
                        <SelectItem value="More than one">More than one</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Owner 1 (Required) */}
                  <div className="bg-gray-50 p-6 rounded-xl border-2 border-gray-200">
                    <h4 className="text-md font-semibold text-gray-800 mb-4">Owner 1 (Primary) *</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="owner_1_name" className="text-sm font-semibold text-gray-700">Full Name *</Label>
                        <Input 
                          id="owner_1_name" 
                          value={owner_1_name} 
                          onChange={(e) => set_owner_1_name(e.target.value)} 
                          className="mt-2" 
                          placeholder="John Doe"
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="owner_1_ownership_pct" className="text-sm font-semibold text-gray-700">Ownership % *</Label>
                        <Input 
                          id="owner_1_ownership_pct" 
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={owner_1_ownership_pct} 
                          onChange={(e) => set_owner_1_ownership_pct(e.target.value)} 
                          className="mt-2" 
                          placeholder="100"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {/* Additional Owners (Conditional) */}
                  {number_of_owners === "More than one" && (
                    <>
                      {/* Owner 2 */}
                      <div className="bg-gray-50 p-6 rounded-xl border-2 border-gray-200">
                        <h4 className="text-md font-semibold text-gray-800 mb-4">Owner 2</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="owner_2_name" className="text-sm font-semibold text-gray-700">Full Name</Label>
                            <Input 
                              id="owner_2_name" 
                              value={owner_2_name} 
                              onChange={(e) => set_owner_2_name(e.target.value)} 
                              className="mt-2" 
                              placeholder="Jane Smith"
                            />
                          </div>
                          <div>
                            <Label htmlFor="owner_2_ownership_pct" className="text-sm font-semibold text-gray-700">Ownership %</Label>
                            <Input 
                              id="owner_2_ownership_pct" 
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={owner_2_ownership_pct} 
                              onChange={(e) => set_owner_2_ownership_pct(e.target.value)} 
                              className="mt-2" 
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Owner 3 */}
                      <div className="bg-gray-50 p-6 rounded-xl border-2 border-gray-200">
                        <h4 className="text-md font-semibold text-gray-800 mb-4">Owner 3</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="owner_3_name" className="text-sm font-semibold text-gray-700">Full Name</Label>
                            <Input 
                              id="owner_3_name" 
                              value={owner_3_name} 
                              onChange={(e) => set_owner_3_name(e.target.value)} 
                              className="mt-2" 
                              placeholder="Optional"
                            />
                          </div>
                          <div>
                            <Label htmlFor="owner_3_ownership_pct" className="text-sm font-semibold text-gray-700">Ownership %</Label>
                            <Input 
                              id="owner_3_ownership_pct" 
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={owner_3_ownership_pct} 
                              onChange={(e) => set_owner_3_ownership_pct(e.target.value)} 
                              className="mt-2" 
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Owner 4 */}
                      <div className="bg-gray-50 p-6 rounded-xl border-2 border-gray-200">
                        <h4 className="text-md font-semibold text-gray-800 mb-4">Owner 4</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="owner_4_name" className="text-sm font-semibold text-gray-700">Full Name</Label>
                            <Input 
                              id="owner_4_name" 
                              value={owner_4_name} 
                              onChange={(e) => set_owner_4_name(e.target.value)} 
                              className="mt-2" 
                              placeholder="Optional"
                            />
                          </div>
                          <div>
                            <Label htmlFor="owner_4_ownership_pct" className="text-sm font-semibold text-gray-700">Ownership %</Label>
                            <Input 
                              id="owner_4_ownership_pct" 
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={owner_4_ownership_pct} 
                              onChange={(e) => set_owner_4_ownership_pct(e.target.value)} 
                              className="mt-2" 
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Owner 5 */}
                      <div className="bg-gray-50 p-6 rounded-xl border-2 border-gray-200">
                        <h4 className="text-md font-semibold text-gray-800 mb-4">Owner 5</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="owner_5_name" className="text-sm font-semibold text-gray-700">Full Name</Label>
                            <Input 
                              id="owner_5_name" 
                              value={owner_5_name} 
                              onChange={(e) => set_owner_5_name(e.target.value)} 
                              className="mt-2" 
                              placeholder="Optional"
                            />
                          </div>
                          <div>
                            <Label htmlFor="owner_5_ownership_pct" className="text-sm font-semibold text-gray-700">Ownership %</Label>
                            <Input 
                              id="owner_5_ownership_pct" 
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={owner_5_ownership_pct} 
                              onChange={(e) => set_owner_5_ownership_pct(e.target.value)} 
                              className="mt-2" 
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  <div className="flex flex-col sm:flex-row justify-between gap-4 pt-6">
                    <Button 
                      onClick={() => set_step(3)} 
                      variant="outline" 
                      className="border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50 px-8 py-6"
                    >
                      <ChevronLeft className="mr-2 w-5 h-5" />
                      Previous
                    </Button>
                    <Button 
                      onClick={() => set_step(5)} 
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-8 py-6 shadow-lg"
                    >
                      Next: Credit
                      <ChevronRight className="ml-2 w-5 h-5" />
                    </Button>
                  </div>
                </div>
              )}

              {/* STEP 5: Credit & Special Situations */}
              {step === 5 && (
                <div className="space-y-6 animate-fade-in">
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-orange-900 mb-2">Credit & Special Situations</h3>
                    <p className="text-sm text-orange-700">Help us understand your credit situation and risk factors</p>
                  </div>

                  {/* Credit Score Section */}
                  <div>
                    <Label className="text-sm font-semibold text-gray-700 mb-3 block">Credit Score Range *</Label>
                    <div role="radiogroup" aria-label="Credit Score Range" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {CREDIT_SCORE_OPTIONS.map((opt) => (
                        <label
                          key={opt.value}
                          className={`flex items-center p-3 rounded-lg border cursor-pointer transition-colors ${
                            credit_score === opt.value ? "bg-emerald-50 border-emerald-300" : "bg-white border-gray-200"
                          }`}
                        >
                          <input
                            type="radio"
                            name="credit_score"
                            value={opt.value}
                            checked={credit_score === opt.value}
                            onChange={() => set_credit_score(opt.value)}
                            className="mr-3 h-4 w-4 text-emerald-600 accent-emerald-600"
                          />
                          <span className="text-sm text-gray-700">{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Risk Assessment Questions */}
                  <div className="space-y-4">
                    <h3 className="text-md font-semibold text-gray-800 border-b pb-2">
                      Risk Assessment Questions
                    </h3>
                    
                    {/* Main risk assessment checkboxes - displayed in a grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Has existing loans checkbox */}
                      <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors">
                        <Checkbox 
                          id="has_existing_loans" 
                          checked={has_existing_loans} 
                          onCheckedChange={(checked) => set_has_existing_loans(checked as boolean)} 
                          className="mt-1" 
                        />
                        <Label htmlFor="has_existing_loans" className="text-sm text-gray-700 cursor-pointer">
                          Has existing loans or advances
                        </Label>
                      </div>

                      {/* Defaulted on MCA checkbox */}
                      <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors">
                        <Checkbox 
                          id="has_defaulted_mca" 
                          checked={has_defaulted_mca} 
                          onCheckedChange={(checked) => set_has_defaulted_mca(checked as boolean)} 
                          className="mt-1" 
                        />
                        <Label htmlFor="has_defaulted_mca" className="text-sm text-gray-700 cursor-pointer">
                          Defaulted on MCA
                        </Label>
                      </div>

                      {/* Reduced MCA payments checkbox */}
                      <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors">
                        <Checkbox 
                          id="has_reduced_mca_payments" 
                          checked={has_reduced_mca_payments} 
                          onCheckedChange={(checked) => set_has_reduced_mca_payments(checked as boolean)} 
                          className="mt-1" 
                        />
                        <Label htmlFor="has_reduced_mca_payments" className="text-sm text-gray-700 cursor-pointer">
                          Reduced MCA payments
                        </Label>
                      </div>

                      {/* Owns real estate checkbox */}
                      <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors">
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

                      {/* Personal CC debt over $75k checkbox */}
                      <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors">
                        <Checkbox 
                          id="has_personal_debt_over_75k" 
                          checked={has_personal_debt_over_75k} 
                          onCheckedChange={(checked) => set_has_personal_debt_over_75k(checked as boolean)} 
                          className="mt-1" 
                        />
                        <Label htmlFor="has_personal_debt_over_75k" className="text-sm text-gray-700 cursor-pointer">
                          Personal CC debt over $75k
                        </Label>
                      </div>
                    </div>

                    {/* Conditional field: Show if client has defaulted on MCA */}
                    {has_defaulted_mca && (
                      <div className="mt-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                        <div className="flex items-start space-x-3">
                          <Checkbox 
                            id="mca_was_satisfied" 
                            checked={mca_was_satisfied} 
                            onCheckedChange={(checked) => set_mca_was_satisfied(checked as boolean)} 
                            className="mt-1" 
                          />
                          <Label htmlFor="mca_was_satisfied" className="text-sm text-gray-700 cursor-pointer">
                            MCA was satisfied (debt has been paid off)
                          </Label>
                        </div>
                      </div>
                    )}

                    {/* Conditional field: Show if client has reduced MCA payments */}
                    {has_reduced_mca_payments && (
                      <div className="mt-4 p-4 bg-white rounded-lg border border-blue-200">
                        <Label htmlFor="reduced_payments_months_ago" className="text-sm font-semibold text-gray-700">
                          How many months ago did payments reduce?
                        </Label>
                        <Input 
                          id="reduced_payments_months_ago" 
                          type="number" 
                          value={reduced_payments_months_ago} 
                          onChange={(e) => set_reduced_payments_months_ago(e.target.value ? Number(e.target.value) : "")} 
                          className="mt-2" 
                          placeholder="Number of months" 
                        />
                      </div>
                    )}

                    {/* Conditional field: Show if client has personal CC debt over $75k */}
                    {has_personal_debt_over_75k && (
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
                            className="pl-7" 
                            placeholder="Amount" 
                          />
                        </div>
                      </div>
                    )}

                    {/* Bankruptcy/Foreclosure checkbox */}
                    <div className="grid grid-cols-1 gap-3 mt-3">
                      <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors">
                        <Checkbox 
                          id="has_bankruptcy_foreclosure_3y" 
                          checked={has_bankruptcy_foreclosure_3y} 
                          onCheckedChange={(checked) => set_has_bankruptcy_foreclosure_3y(checked as boolean)} 
                          className="mt-1" 
                        />
                        <Label htmlFor="has_bankruptcy_foreclosure_3y" className="text-sm text-gray-700 cursor-pointer">
                          Foreclosures or bankruptcies in past 3 years
                        </Label>
                      </div>
                    </div>

                    {/* Conditional fields: Show if client has bankruptcy/foreclosure */}
                    {has_bankruptcy_foreclosure_3y && (
                      <div className="mt-4 p-4 bg-white rounded-lg border border-blue-200 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Months ago field */}
                          <div>
                            <Label htmlFor="bk_fc_months_ago" className="text-sm font-semibold text-gray-700">
                              How many months ago?
                            </Label>
                            <Input 
                              id="bk_fc_months_ago" 
                              type="number" 
                              value={bk_fc_months_ago} 
                              onChange={(e) => set_bk_fc_months_ago(e.target.value ? Number(e.target.value) : "")} 
                              className="mt-2" 
                              placeholder="Months" 
                            />
                          </div>
                          {/* Type selection field */}
                          <div>
                            <Label htmlFor="bk_fc_type" className="text-sm font-semibold text-gray-700">
                              Type
                            </Label>
                            <Select value={bk_fc_type} onValueChange={set_bk_fc_type}>
                              <SelectTrigger className="mt-2">
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

                    {/* Tax liens checkbox */}
                    <div className="grid grid-cols-1 gap-3 mt-3">
                      <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors">
                        <Checkbox 
                          id="has_tax_liens" 
                          checked={has_tax_liens} 
                          onCheckedChange={(checked) => set_has_tax_liens(checked as boolean)} 
                          className="mt-1" 
                        />
                        <Label htmlFor="has_tax_liens" className="text-sm text-gray-700 cursor-pointer">
                          Tax liens
                        </Label>
                      </div>
                    </div>

                    {/* Conditional fields: Show if client has tax liens */}
                    {has_tax_liens && (
                      <div className="mt-4 p-4 bg-white rounded-lg border border-blue-200 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Tax lien type selection */}
                          <div>
                            <Label htmlFor="tax_liens_type" className="text-sm font-semibold text-gray-700">
                              Tax lien type
                            </Label>
                            <Select value={tax_liens_type} onValueChange={set_tax_liens_type}>
                              <SelectTrigger className="mt-2">
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="personal">Personal</SelectItem>
                                <SelectItem value="business">Business</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {/* Tax lien amount field */}
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
                                className="pl-7" 
                                placeholder="Amount" 
                              />
                            </div>
                          </div>
                        </div>
                        {/* Payment plan checkbox */}
                        <div className="flex items-start space-x-3 p-3 hover:bg-gray-50 rounded-lg transition-colors">
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

                    {/* Judgements checkbox */}
                    <div className="grid grid-cols-1 gap-3 mt-3">
                      <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors">
                        <Checkbox 
                          id="has_active_judgements" 
                          checked={has_active_judgements} 
                          onCheckedChange={(checked) => set_has_active_judgements(checked as boolean)} 
                          className="mt-1" 
                        />
                        <Label htmlFor="has_active_judgements" className="text-sm text-gray-700 cursor-pointer">
                          Judgements
                        </Label>
                      </div>
                    </div>

                    {/* Conditional field: Show if client has judgements */}
                    {has_active_judgements && (
                      <div className="mt-4 p-4 bg-white rounded-lg border border-blue-200">
                        <Label htmlFor="judgements_explain" className="text-sm font-semibold text-gray-700">
                          Explain
                        </Label>
                        <Textarea 
                          id="judgements_explain" 
                          value={judgements_explain} 
                          onChange={(e) => set_judgements_explain(e.target.value)} 
                          className="mt-2" 
                          placeholder="Explain any judgements..." 
                          rows={3} 
                        />
                      </div>
                    )}

                    {/* ZBL (Zero Balance Letter) checkbox */}
                    <div className="grid grid-cols-1 gap-3 mt-3">
                      <div className="flex items-start space-x-3 p-3 hover:bg-blue-100 rounded-lg transition-colors">
                        <Checkbox 
                          id="has_zbl" 
                          checked={has_zbl} 
                          onCheckedChange={(checked) => set_has_zbl(checked as boolean)} 
                          className="mt-1" 
                        />
                        <Label htmlFor="has_zbl" className="text-sm text-gray-700 cursor-pointer">
                          Has ZBL (Zero Balance Letter)
                        </Label>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row justify-between gap-4 pt-6">
                    <Button 
                      onClick={() => set_step(4)} 
                      variant="outline" 
                      className="border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50 px-8 py-6"
                    >
                      <ChevronLeft className="mr-2 w-5 h-5" />
                      Previous
                    </Button>
                    <Button 
                      onClick={() => set_step(6)} 
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-8 py-6 shadow-lg"
                    >
                      Next: Final Details
                      <ChevronRight className="ml-2 w-5 h-5" />
                    </Button>
                  </div>
                </div>
              )}

              {/* STEP 6: Final Details */}
              {step === 6 && (
                <div className="space-y-6 animate-fade-in">
                  <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-indigo-900 mb-2">Final Details</h3>
                    <p className="text-sm text-indigo-700">Just a few more details and you're done!</p>
                  </div>

                  <div>
                    <Label htmlFor="funding_eta" className="text-sm font-semibold text-gray-700 mb-3 block">How soon do they need funds? *</Label>
                    <Select value={funding_eta} onValueChange={set_funding_eta}>
                      <SelectTrigger className="max-w-xs">
                        <SelectValue placeholder="Select timeframe" />
                      </SelectTrigger>
                      <SelectContent>
                        {FUNDING_URGENCY.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="additional_notes" className="text-sm font-semibold text-gray-700">Additional Information *</Label>
                    <Textarea 
                      id="additional_notes" 
                      value={additional_notes} 
                      onChange={(e) => set_additional_notes(e.target.value)} 
                      className="mt-2" 
                      placeholder="Any additional information we should know..."
                      rows={5}
                      required
                    />
                  </div>

                  {/* Documents Requested Section */}
                  {/* This section tracks which documents need to be collected from the client */}
                  {/* Each selected document will generate a "requested_{doc_name}" tag in GHL */}
                  <div className="space-y-4">
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
                      <h3 className="text-lg font-semibold text-blue-900 mb-1">Documents Requested</h3>
                      <p className="text-sm text-blue-700">
                        Select all documents that need to be collected from this client
                      </p>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-gray-50 p-4 md:p-6 rounded-xl border-2 border-gray-200">
                      {DOC_OPTIONS.map((doc) => (
                        <div 
                          key={doc} 
                          className="flex items-start space-x-3 p-3 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-blue-200"
                        >
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
                    
                    {/* Show selected documents count */}
                    {documents_requested.length > 0 && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <p className="text-sm text-blue-900">
                          <strong>{documents_requested.length}</strong> document{documents_requested.length !== 1 ? 's' : ''} requested
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Advisor Selection */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">Advisor Assignment *</h3>
                    <p className="text-sm text-gray-600">Select the advisor who will work with this client</p>
                    {loading_advisors ? (
                      <div className="text-sm text-gray-500">Loading advisors...</div>
                    ) : advisors.length === 0 ? (
                      <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
                        No active advisors found
                      </div>
                    ) : (
                      <Select value={advisor_id} onValueChange={set_advisor_id}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select an advisor" />
                        </SelectTrigger>
                        <SelectContent>
                          {advisors.map((advisor) => (
                            <SelectItem key={advisor.id} value={advisor.id}>
                              {advisor.first_name} {advisor.last_name} ({advisor.email})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {advisor_id && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded p-4">
                        <p className="text-sm font-semibold text-emerald-900">Selected Advisor:</p>
                        {(() => {
                          const selected = advisors.find(a => a.id === advisor_id);
                          return selected ? (
                            <div className="mt-2 text-sm text-emerald-800">
                              <p><strong>Name:</strong> {selected.first_name} {selected.last_name}</p>
                              <p><strong>Email:</strong> {selected.email}</p>
                              {selected.phone && <p><strong>Phone:</strong> {selected.phone}</p>}
                            </div>
                          ) : null;
                        })()}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row justify-between gap-4 pt-8 border-t-2 border-gray-200">
                    <Button 
                      onClick={() => set_step(5)} 
                      variant="outline" 
                      className="border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50 px-8 py-6"
                    >
                      <ChevronLeft className="mr-2 w-5 h-5" />
                      Previous
                    </Button>
                    <Button 
                      onClick={handle_submit} 
                      disabled={submitting} 
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-12 py-6 shadow-lg disabled:opacity-50"
                    >
                      {submitting ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                          Creating Account...
                        </>
                      ) : (
                        <>
                          Complete & Get Access
                          <CheckCircle2 className="ml-2 w-5 h-5" />
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

      <style jsx global>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}