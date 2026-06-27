"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useRouter, usePathname } from "next/navigation";
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
  Clock,
  AlertCircle,
  Plus,
  Trash2
} from "lucide-react";
import { addManualFundingApplication } from "@/app/advisor/dashboard/clients/[id]/actions";
import { useErrorDialog } from "@/components/error-dialog";
import { FollowersPicker } from "@/components/followers-picker";
import { FUNDING_OPTIONS, LOAN_TYPES } from "@/data/loan-types";


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
  { value: '650 - 700', label: '650 - 700' },
  { value: '600 - 650', label: '600 - 650' },
  { value: '550 - 600', label: '550 - 600' },
  { value: 'Below 550', label: 'Below 550' },
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
  ghl_user_id: string | null;
};

type OpenPosition = {
  lender_name: string;
  loan_type: string;
  initial_balance: string;       // original advance / starting principal — optional
  current_balance: string;
  payment_amount: string;
  payment_frequency: string;     // 'Daily' | 'Weekly' | 'Bi-Weekly' | 'Monthly'
  term_remaining: string;        // # of remaining payments — optional
};

const PAYMENT_FREQUENCIES = ['Daily', 'Weekly', 'Bi-Weekly', 'Monthly'] as const;

// Default cadence + term-unit label per loan type. Drives the auto-fill that
// fires when the advisor picks a loan type, and the help text on the term
// field. Unknown loan types fall through to a no-default empty state.
const LOAN_TYPE_DEFAULTS: Record<string, { frequency: string; term_unit: string }> = {
  'MCA':                      { frequency: 'Daily',   term_unit: 'remaining debits' },
  'Factor':                   { frequency: 'Daily',   term_unit: 'remaining debits' },
  'AR Loan':                  { frequency: 'Daily',   term_unit: 'remaining debits' },
  'Revenue Based Loan':       { frequency: 'Daily',   term_unit: 'remaining debits' },
  'SBA Loan':                 { frequency: 'Monthly', term_unit: 'months remaining' },
  'Term Loan':                { frequency: 'Monthly', term_unit: 'months remaining' },
  'Real Estate Loan':         { frequency: 'Monthly', term_unit: 'months remaining' },
  'Acquisition':              { frequency: 'Monthly', term_unit: 'months remaining' },
  'Personal Term Loan':       { frequency: 'Monthly', term_unit: 'months remaining' },
  'Project Financing':        { frequency: 'Monthly', term_unit: 'months remaining' },
  'Equipment':                { frequency: 'Monthly', term_unit: 'months remaining' },
  'Inventory Financing':      { frequency: 'Monthly', term_unit: 'months remaining' },
  'Purchase Order Financing': { frequency: 'Monthly', term_unit: 'months remaining' },
  'E-commerce':               { frequency: 'Weekly',  term_unit: 'weeks remaining' },
  'Line of Credit':           { frequency: 'Monthly', term_unit: 'months remaining' },
};


export default function ClientSignupForm() {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  const [step, set_step] = useState(1);
  const [submitting, set_submitting] = useState(false);
  const { showError } = useErrorDialog();

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
  const [proposed_loan_types, set_proposed_loan_types] = useState<string[]>([]);
  const [avg_monthly_deposits, set_avg_monthly_deposits] = useState("");
  const [avg_annual_revenue, set_avg_annual_revenue] = useState("");



  // Helper function to toggle document selection
  // Adds or removes documents from the requested list
  const toggle_document = (doc: string) => {
    set_documents_requested((prev) =>
      prev.includes(doc) ? prev.filter((d) => d !== doc) : [...prev, doc]
    );
  };

  // Helper to toggle a loan type in the multi-select
  const toggle_loan_type = (type: string) => {
    set_proposed_loan_types((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  // ===== PASO 4: Propietarios =====
  const [number_of_owners, set_number_of_owners] = useState("One");
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

  // ===== PASO 5.5: Open Positions (Previous Debt) =====
  const empty_position = (): OpenPosition => ({
    lender_name: "",
    loan_type: "",
    initial_balance: "",
    current_balance: "",
    payment_amount: "",
    payment_frequency: "",
    term_remaining: "",
  });
  const [open_positions, set_open_positions] = useState<OpenPosition[]>([empty_position()]);
  // Lender autocomplete source — pulled from lender_guidelines so the same
  // names the in-app match tool knows about are offered here. Mismatch
  // (custom-typed text) is allowed for one-off / private lenders.
  const [lender_options, set_lender_options] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('lender_guidelines')
        .select('lender_name')
        .order('lender_name', { ascending: true });
      if (cancelled) return;
      // Dedupe case-insensitively — the lender_guidelines table has duplicate
      // rows (multiple programs per lender), and the datalist key is the name
      // itself, so dupes cause React key collisions on render.
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const r of (data ?? []) as { lender_name: string }[]) {
        const name = r.lender_name;
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(name);
      }
      set_lender_options(unique);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const add_position = () => {
    if (open_positions.length < 5) {
      set_open_positions((prev) => [...prev, empty_position()]);
    }
  };

  const remove_position = (idx: number) => {
    set_open_positions((prev) => prev.filter((_, i) => i !== idx));
  };

  const update_position = (idx: number, field: keyof OpenPosition, value: string) => {
    set_open_positions((prev) =>
      prev.map((pos, i) => (i === idx ? { ...pos, [field]: value } : pos))
    );
  };

  // Picking a loan type auto-fills payment_frequency when it's still empty.
  // We don't overwrite an existing choice — once the advisor has set Daily
  // and then changes loan type, their explicit choice stays.
  const set_position_loan_type = (idx: number, loan_type: string) => {
    set_open_positions((prev) =>
      prev.map((pos, i) => {
        if (i !== idx) return pos;
        const defaults = LOAN_TYPE_DEFAULTS[loan_type];
        return {
          ...pos,
          loan_type,
          payment_frequency: pos.payment_frequency || defaults?.frequency || "",
        };
      })
    );
  };

  // Per-position validation used at submit time. Returns the first error or
  // null if the position is valid (or empty — empty positions are dropped
  // before send by the lender_name.trim() filter).
  const validate_position = (pos: OpenPosition, idx: number): string | null => {
    const is_empty = !pos.lender_name.trim() && !pos.loan_type && !pos.current_balance
      && !pos.payment_amount && !pos.payment_frequency;
    if (is_empty) return null;
    const label = `Position ${idx + 1}`;
    if (!pos.lender_name.trim()) return `${label}: lender name is required.`;
    if (!pos.loan_type) return `${label}: loan type is required.`;
    if (!pos.payment_frequency) return `${label}: payment frequency is required.`;
    if (!PAYMENT_FREQUENCIES.includes(pos.payment_frequency as any)) {
      return `${label}: invalid payment frequency.`;
    }
    const balance = parseFloat(pos.current_balance);
    if (!Number.isFinite(balance) || balance < 0) return `${label}: current balance must be a non-negative number.`;
    const payment = parseFloat(pos.payment_amount);
    if (!Number.isFinite(payment) || payment < 0) return `${label}: payment amount must be a non-negative number.`;
    if (pos.initial_balance) {
      const init = parseFloat(pos.initial_balance);
      if (!Number.isFinite(init) || init < 0) return `${label}: initial balance must be a non-negative number.`;
    }
    if (pos.term_remaining) {
      const term = parseInt(pos.term_remaining, 10);
      if (!Number.isFinite(term) || term < 0) return `${label}: term remaining must be a non-negative whole number.`;
    }
    return null;
  };

  // ===== PASO 6: Timeline, Notas y Advisor =====
  const [funding_eta, set_funding_eta] = useState("");
  const [additional_notes, set_additional_notes] = useState("");
  const [advisor_id, set_advisor_id] = useState("");

  // Follower advisors: additional advisors that should receive every email the primary advisor receives.
  const [follower_advisor_ids, set_follower_advisor_ids] = useState<string[]>([]);
  const toggle_follower = (id: string) => {
    set_follower_advisor_ids(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  };
  // Keep the primary advisor out of the follower list whenever it changes
  useEffect(() => {
    if (!advisor_id) return;
    set_follower_advisor_ids(prev => prev.filter(id => id !== advisor_id));
  }, [advisor_id]);

  // ===== Documents Requested =====
  // Tracks which documents are requested from the client
  // Each selected document will generate a "requested_{doc}" tag in GHL
  const [documents_requested, set_documents_requested] = useState<string[]>([]);
  // Bank statements only: how many months to request (others ignore it).
  const [statement_months, set_statement_months] = useState(12);

  // ===== Advisor Context & Success State =====
  // Detects if form is being used by an advisor (vs public client signup)
  // This determines success flow: advisor stays on page, client redirects to login
  const [is_advisor_context, set_is_advisor_context] = useState(false);
  const [show_success, set_show_success] = useState(false);
  const [created_client_email, set_created_client_email] = useState("");
  const [created_client_name, set_created_client_name] = useState("");

  // ===== Already Signed Funding Application =====
  const [has_already_signed, set_has_already_signed] = useState(false);
  const [signed_document_file, set_signed_document_file] = useState<File | null>(null);

  // Check if current user is an advisor
  // This determines the success flow: redirect to login page (client) vs stay on page (advisor)
  useEffect(() => {
    async function check_user_role() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: user_data } = await supabase
          .from("users")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();

        // Admins also act as advisors when creating clients — they have an
        // advisors row of their own and the client must be assigned to them
        // (same auto-assignment + same form layout, including the manual
        // funding-app upload section).
        if (user_data?.role === "advisor" || user_data?.role === "admin") {
          set_is_advisor_context(true);

          // Auto-assign advisor/admin if they are logged in
          if (user.email) {
            // Find advisor by user_id for more reliable mapping than email
            const { data: advisor_record } = await supabase
              .from("advisors")
              .select("id, first_name, last_name")
              .eq("user_id", user.id)
              .maybeSingle();

            if (advisor_record) {
              set_advisor_id(advisor_record.id);
              console.log(`✅ Advisor auto-assigned: ${advisor_record.first_name} ${advisor_record.last_name}`);
            } else {
              // Fallback: try matching by email — common when an advisor row
              // was created (e.g., via bulk import) before `user_id` was linked.
              // The server resolves this authoritatively, but we also try here
              // so the UI shows the correct advisor immediately.
              const { data: advisor_by_email } = await supabase
                .from("advisors")
                .select("id, first_name, last_name")
                .ilike("email", user.email)
                .maybeSingle();

              if (advisor_by_email) {
                set_advisor_id(advisor_by_email.id);
                console.log(`✅ Advisor matched by email: ${advisor_by_email.first_name} ${advisor_by_email.last_name}`);
              } else {
                console.warn(`⚠️ User has role "${user_data.role}" but no record found in "advisors" table for email: ${user.email} — the server will try to resolve by session at submit time.`);
              }
            }
          }
        }
      }
    }
    check_user_role();
  }, [supabase]);

  // Fetch advisors
  useEffect(() => {
    async function fetch_advisors() {
      try {
        const { data, error } = await supabase
          .from("advisors")
          .select("id, first_name, last_name, email, phone, profile_pic_url, ghl_user_id")
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

  // Mapping of document labels to their internal codes (must match vault.tsx)
  const DOC_TAG_MAP: Record<string, string> = {
    "Business Bank Statements": "business_bank_statements",
    "Business/Personal Tax Returns": "tax_returns",
    "Profit & Loss Statement": "profit_loss",
    "Balance Sheet": "balance_sheets",
    "Debt Schedule": "debt_schedule",
    "A/R Report": "ar_report",
    "Driver's License": "drivers_license",
    "Voided Check": "voided_check",
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
    // Each requested document gets a "requested_{doc_code}" tag
    // When the document is uploaded, the tag should be changed to "submitted_{doc_code}"
    // and the "requested_" tag should be removed
    documents_requested.forEach((doc) => {
      const doc_code = DOC_TAG_MAP[doc];
      if (doc_code) {
        tags.push(`requested_${doc_code}`);
      } else {
        // Fallback for unknown documents (shouldn't happen if map is complete)
        const tag_name = doc
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '_');
        tags.push(`requested_${tag_name}`);
      }
    });

    return tags;
  };

  // Handle submit
  const handle_submit = async () => {
    set_submitting(true);

    try {
      // Require every field that maps to a NOT NULL column in client_data_vault.
      // The server validates these too, but a missing field used to slip through
      // and fail on the DB constraint only AFTER the auth user / profile / GHL
      // contact were created — leaving a half-built "ghost" client. Catch it here
      // for instant feedback before any of that runs.
      const required_fields: Record<string, string> = {
        "Client name": client_name,
        "Company name": company_name,
        "Client email": client_email,
        "Client phone": client_phone,
        "Company state": company_state,
        "Company zip code": company_zip_code,
        "Capital requested": capital_requested,
        "Loan purpose": loan_purpose,
        "Average monthly deposits": avg_monthly_deposits,
        "Average annual revenue": avg_annual_revenue,
        "Legal entity type": legal_entity_type,
        "Business start date": business_start_date,
        "Number of employees": employees_count,
        "Owner 1 name": owner_1_name,
        "Credit score": credit_score,
        "Funding ETA": funding_eta,
      };
      const missing = Object.entries(required_fields)
        .filter(([, val]) => !String(val ?? "").trim())
        .map(([label]) => label);
      if (proposed_loan_types.length === 0) missing.push("Proposed loan type");
      if (missing.length > 0) {
        throw new Error(`Please complete all required fields: ${missing.join(", ")}.`);
      }

      // Require at least one requested document. Creating a vault with an empty
      // request leaves the client with nothing to upload and produces the
      // "empty doc request" clients — block it at the source.
      if (documents_requested.length === 0) {
        throw new Error("Select at least one document to request before creating the client.");
      }

      // Validar ownership percentages
      if (!validate_ownership()) {
        throw new Error("Ownership percentages must sum to 100%");
      }

      // Validate open positions only when the client claims existing loans —
      // an empty positions list with the flag unchecked is still a valid form.
      if (has_existing_loans) {
        for (let i = 0; i < open_positions.length; i++) {
          const err = validate_position(open_positions[i], i);
          if (err) throw new Error(err);
        }
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

        // Serialize the multi-select to a comma-separated string for the DB text column and GHL
        proposed_loan_type: proposed_loan_types.join(", "),

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

        // ===== Open Positions (Previous Debt) =====
        // Only sent if client has existing loans
        open_positions: has_existing_loans
          ? open_positions.filter((p) => p.lender_name.trim() !== "")
          : [],

        // Timeline y notas
        funding_eta,
        additional_notes,

        // Advisor
        advisor_name,
        advisor_id,

        // Followers — advisors that should be CC'd on every client email
        follower_advisor_ids: follower_advisor_ids.filter(id => id && id !== advisor_id),

        // ===== Documents Requested =====
        // List of documents that need to be collected from the client
        documents_requested,
        // Months of bank statements to request (only applies to that doc).
        statement_months,

        // ===== GHL Tags =====
        // These tags will be sent to Go High Level for contact categorization
        ghl_tags: generate_ghl_tags(),

        // ===== Contract Completion =====
        contract_completed: has_already_signed,
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

      // If already signed, upload the document
      if (has_already_signed && signed_document_file && result.data.vault_id) {
        const formData = new FormData();
        formData.append("file", signed_document_file);
        try {
          await addManualFundingApplication(result.data.vault_id, formData);
        } catch (upload_err) {
          console.error("Error uploading funding application:", upload_err);
          // We don't fail the whole signup if just the file upload fails, 
          // but maybe we should show a warning.
        }
      }

      // Handle success based on context
      if (is_advisor_context) {
        // Advisor context: Show success modal and stay on page
        set_created_client_email(client_email);
        set_created_client_name(client_name);
        set_show_success(true);

        // Form is reset via "Create Another" button
      } else {
        // Client self-signup context: Redirect to success page with login credentials
        router.push(`/auth/sign-up-success?email=${encodeURIComponent(client_email)}`);
      }
    } catch (err: any) {
      showError(err, { context: "Creating the client" });
    } finally {
      set_submitting(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-[3rem] bg-[#f0fdf7]">
      {/* aurora-glow effect for consistency */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/30 via-white/80 to-white pointer-events-none" />
      <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-emerald-200/10 blur-[120px] rounded-full pointer-events-none animate-aurora" />
      <div className="absolute bottom-0 left-0 w-[40%] h-[40%] bg-blue-100/5 blur-[120px] rounded-full pointer-events-none animate-aurora" style={{ animationDelay: '-3s' }} />
      {/* Success Modal for Advisor Context */}
      {/* This modal appears when an advisor successfully creates a client */}
      {/* Shows client credentials and auto-refreshes page for next client */}
      {show_success && (
        <div className="fixed inset-0 bg-emerald-950/40 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[3rem] shadow-2xl max-w-2xl w-full p-10 md:p-14 animate-fade-in relative overflow-hidden border border-emerald-50">
            {/* abstract bg decoration */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full blur-3xl -mr-10 -mt-10" />

            <div className="text-center mb-10 relative z-10">
              <div className="mx-auto w-24 h-24 bg-emerald-50 rounded-[2rem] flex items-center justify-center mb-6 border border-emerald-100 shadow-inner">
                <CheckCircle2 className="w-12 h-12 text-emerald-500" />
              </div>
              <h2 className="text-4xl font-black text-emerald-950 uppercase tracking-tighter mb-3">
                Client Created Successfully!
              </h2>
              <p className="text-emerald-950/40 font-bold text-lg">
                The onboarding process for {created_client_name} has started.
              </p>
            </div>

            <div className="bg-emerald-50/50 rounded-[2.5rem] p-8 mb-8 border border-emerald-50 relative z-10">
              <h3 className="text-xs font-black text-emerald-900/40 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                Client Information
              </h3>

              <div className="space-y-4">
                <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 border border-emerald-50">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-900/30 mb-2">Email Address</p>
                  <p className="text-xl font-black text-emerald-950">{created_client_email}</p>
                </div>
              </div>
            </div>

            <div className="bg-emerald-950 rounded-[2rem] p-6 mb-10 relative z-10">
              <p className="text-sm font-bold text-emerald-50/60 leading-relaxed text-center">
                Your client will receive all further instructions via email at <span className="text-white underline decoration-emerald-500/50">{created_client_email}</span>.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 relative z-10">
              <Button
                onClick={() => window.location.reload()}
                className="flex-1 h-14 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95"
              >
                Create Another
              </Button>
              <Button
                onClick={() => router.push(pathname.startsWith('/admin') ? '/admin/prospects' : '/advisor/dashboard/prospects')}
                variant="outline"
                className="flex-1 h-14 border-2 border-emerald-100 text-emerald-950 font-black rounded-2xl hover:bg-emerald-50 transition-all active:scale-95"
              >
                View Prospect List
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full px-4 py-8 md:py-12">
        <Card className="shadow-2xl border-emerald-50 rounded-[3rem] overflow-hidden relative z-10 bg-white">
          <CardHeader className="border-b border-emerald-50 bg-white p-10 md:p-14">
            <CardTitle className="text-3xl font-black text-emerald-950 uppercase tracking-tighter">New Client Application</CardTitle>
            <CardDescription className="text-lg font-bold text-emerald-900/40 mt-3 flex flex-col gap-2">
              <span>Please complete your client information below. Login credentials will be sent immediately after submission</span>
              <span className="text-sm text-emerald-600/80 bg-emerald-50 w-fit px-4 py-1.5 rounded-full border border-emerald-100 flex items-center gap-2 mt-2">
                <AlertCircle className="w-4 h-4" />
                Please ensure all fields marked with <span className="text-emerald-500 font-black text-base leading-none">*</span> are completed to avoid errors.
              </span>
            </CardDescription>
          </CardHeader>

          <CardContent className="p-4 md:p-8 lg:p-10">
            {/* Progress Steps */}
            <div className="flex items-center justify-between mb-12 md:mb-16 overflow-x-auto pt-4 pb-8 px-4 scrollbar-hide">
              {[
                { num: 1, label: "Contact", icon: Building2 },
                { num: 2, label: "Location", icon: MapPin },
                { num: 3, label: "Financials", icon: DollarSign },
                { num: 4, label: "Owners", icon: Users },
                { num: 5, label: "Credit", icon: CreditCard },
                { num: 6, label: "Final", icon: Clock },
              ].map((s, idx) => (
                <div key={s.num} className="flex items-center shrink-0">
                  <div
                    className="flex flex-col items-center cursor-pointer group"
                    onClick={() => set_step(s.num)}
                  >
                    <div
                      className={`w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center font-black transition-all duration-500 group-hover:scale-110 active:scale-95
                        ${step === s.num ? "bg-emerald-500 text-white shadow-xl shadow-emerald-500/20 scale-110" :
                          step > s.num ? "bg-emerald-50 text-emerald-500 border border-emerald-100" : "bg-slate-50 text-slate-300 border border-slate-100"}`}
                    >
                      {step > s.num ? <CheckCircle2 className="w-6 h-6" /> : <s.icon className="w-6 h-6" />}
                    </div>
                    <span className={`text-[10px] font-black uppercase tracking-widest mt-3 transition-colors duration-500 ${step === s.num ? "text-emerald-950" : "text-slate-400 group-hover:text-emerald-900"}`}>
                      {s.label}
                    </span>
                  </div>
                  {idx < 5 && (
                    <div className="px-2 md:px-4">
                      <div className={`h-1 w-6 md:w-10 rounded-full transition-all duration-700 ${step > s.num ? "bg-emerald-500" : "bg-slate-100"}`} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="w-full">
              {/* STEP 1: Contact Info */}
              {step === 1 && (
                <div className="space-y-6 animate-fade-in">
                  <div className="bg-emerald-50/50 rounded-3xl p-8 mb-8">
                    <h3 className="text-xl font-black text-emerald-950 uppercase tracking-tighter mb-2">Contact Information</h3>
                    <p className="text-emerald-900/40 font-bold">Let's start with the basic contact details.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div>
                      <Label htmlFor="client_name" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Client Full Name *</Label>
                      <Input
                        id="client_name"
                        value={client_name}
                        onChange={(e) => set_client_name(e.target.value)}
                        className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                        placeholder="John Doe"
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="company_name" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Company Name *</Label>
                      <Input
                        id="company_name"
                        value={company_name}
                        onChange={(e) => set_company_name(e.target.value)}
                        className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                        placeholder="Acme Corp LLC"
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="client_email" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Email Address *</Label>
                      <Input
                        id="client_email"
                        type="email"
                        value={client_email}
                        onChange={(e) => set_client_email(e.target.value)}
                        className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                        placeholder="john@example.com"
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="client_phone" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Phone Number *</Label>
                      <Input
                        id="client_phone"
                        type="tel"
                        value={client_phone}
                        onChange={(e) => set_client_phone(e.target.value)}
                        className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                        placeholder="(555) 123-4567"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-10">
                    <Button
                      onClick={() => set_step(2)}
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black rounded-2xl px-10 py-6 shadow-xl shadow-emerald-500/20 transition-all active:scale-95"
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
                  <div className="bg-emerald-50/50 rounded-3xl p-8 mb-8">
                    <h3 className="text-xl font-black text-emerald-950 uppercase tracking-tighter mb-2">Location & Structure</h3>
                    <p className="text-emerald-900/40 font-bold">Tell us about your business location and structure.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div>
                      <Label htmlFor="company_state" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">State *</Label>
                      <Select value={company_state} onValueChange={set_company_state}>
                        <SelectTrigger className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6">
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
                      <Label htmlFor="company_city" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">City</Label>
                      <Input
                        id="company_city"
                        value={company_city}
                        onChange={(e) => set_company_city(e.target.value)}
                        className="mt-2"
                        placeholder="Los Angeles"
                      />
                    </div>

                    <div>
                      <Label htmlFor="company_zip_code" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">ZIP Code</Label>
                      <Input
                        id="company_zip_code"
                        value={company_zip_code}
                        onChange={(e) => set_company_zip_code(e.target.value)}
                        className="mt-2"
                        placeholder="90210"

                      />
                    </div>

                    <div>
                      <Label htmlFor="legal_entity_type" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Legal Entity Type *</Label>
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
                      <Label htmlFor="business_start_date" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Business Start Date *</Label>
                      <Input
                        id="business_start_date"
                        type="date"
                        value={business_start_date}
                        onChange={(e) => set_business_start_date(e.target.value)}
                        className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="employees_count" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Number of Employees *</Label>
                      <Input
                        id="employees_count"
                        type="number"
                        value={employees_count}
                        onChange={(e) => set_employees_count(e.target.value)}
                        className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                        placeholder="5"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex items-start space-x-3 p-6 bg-emerald-50/30 border border-emerald-50 rounded-2xl transition-colors">
                    <Checkbox
                      id="is_home_based"
                      checked={is_home_based}
                      onCheckedChange={(checked) => set_is_home_based(checked as boolean)}
                      className="mt-1"
                    />
                    <Label htmlFor="is_home_based" className="text-sm font-bold text-emerald-950 cursor-pointer">
                      This is a home-based business
                    </Label>
                  </div>

                  <div className="flex flex-col sm:flex-row justify-between gap-4 pt-10">
                    <Button
                      onClick={() => set_step(1)}
                      variant="outline"
                      className="border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50 px-8 py-6 rounded-2xl font-black transition-all active:scale-95"
                    >
                      <ChevronLeft className="mr-2 w-5 h-5 text-emerald-600" />
                      Previous
                    </Button>
                    <Button
                      onClick={() => set_step(3)}
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black rounded-2xl px-10 py-6 shadow-xl shadow-emerald-500/20 transition-all active:scale-95"
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
                  <div className="bg-emerald-50/50 rounded-3xl p-8 mb-8">
                    <h3 className="text-xl font-black text-emerald-950 uppercase tracking-tighter mb-2">Financial Information</h3>
                    <p className="text-emerald-900/40 font-bold">Tell us about your funding needs and revenue.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div>
                      <Label htmlFor="capital_requested" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Capital Requested *</Label>
                      <div className="relative">
                        <span className="absolute left-6 top-1/2 -translate-y-1/2 text-emerald-950 font-black">$</span>
                        <Input
                          id="capital_requested"
                          type="number"
                          value={capital_requested}
                          onChange={(e) => set_capital_requested(e.target.value)}
                          className="h-14 pl-10 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold"
                          placeholder="50000"
                          required
                        />
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-3 block ml-1">
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
                              <span className={`w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${selected ? "bg-white border-white" : "border-emerald-200"
                                }`}>
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
                      {proposed_loan_types.length > 0 && (
                        <p className="mt-2 text-xs font-bold text-emerald-600">
                          Selected: {proposed_loan_types.join(" · ")}
                        </p>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <Label htmlFor="loan_purpose" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">What will the funds be used for? *</Label>
                      <Textarea
                        id="loan_purpose"
                        value={loan_purpose}
                        onChange={(e) => set_loan_purpose(e.target.value)}
                        className="rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold p-6"
                        placeholder="Equipment purchase, inventory, expansion, etc."
                        rows={3}
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="avg_monthly_deposits" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Average Monthly Deposits *</Label>
                      <div className="relative">
                        <span className="absolute left-6 top-1/2 -translate-y-1/2 text-emerald-950 font-black">$</span>
                        <Input
                          id="avg_monthly_deposits"
                          type="number"
                          value={avg_monthly_deposits}
                          onChange={(e) => set_avg_monthly_deposits(e.target.value)}
                          className="h-14 pl-10 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold"
                          placeholder="10000"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="avg_annual_revenue" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Average Annual Revenue *</Label>
                      <div className="relative">
                        <span className="absolute left-6 top-1/2 -translate-y-1/2 text-emerald-950 font-black">$</span>
                        <Input
                          id="avg_annual_revenue"
                          type="number"
                          value={avg_annual_revenue}
                          onChange={(e) => set_avg_annual_revenue(e.target.value)}
                          className="h-14 pl-10 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold"
                          placeholder="120000"
                          required
                        />
                      </div>
                    </div>
                  </div>


                  <div className="flex flex-col sm:flex-row justify-between gap-4 pt-6">
                    <Button
                      onClick={() => set_step(2)}
                      variant="outline"
                      className="border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50 px-8 py-6 rounded-2xl font-black transition-all active:scale-95"
                    >
                      <ChevronLeft className="mr-2 w-5 h-5 text-emerald-600" />
                      Previous
                    </Button>
                    <Button
                      onClick={() => set_step(4)}
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black rounded-2xl px-10 py-6 shadow-xl shadow-emerald-500/20 transition-all active:scale-95"
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
                  <div className="bg-emerald-50/50 rounded-3xl p-8 mb-8">
                    <h3 className="text-xl font-black text-emerald-950 uppercase tracking-tighter mb-2">Business Ownership</h3>
                    <p className="text-emerald-900/40 font-bold">List all owners and their ownership percentages (must total 100%).</p>
                  </div>

                  <div>
                    <Label htmlFor="number_of_owners" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-3 block ml-1">How many owners? *</Label>
                    <Select value={number_of_owners} onValueChange={set_number_of_owners}>
                      <SelectTrigger className="max-w-xs h-12 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="One">One</SelectItem>
                        <SelectItem value="More than one">More than one</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Owner 1 (Required) */}
                  <div className="bg-emerald-50/20 p-8 rounded-[2rem] border border-emerald-50">
                    <h4 className="text-lg font-black text-emerald-950 uppercase tracking-tight mb-6">Owner 1 (Primary) *</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="owner_1_name" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Full Name *</Label>
                        <Input
                          id="owner_1_name"
                          value={owner_1_name}
                          onChange={(e) => set_owner_1_name(e.target.value)}
                          className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                          placeholder="John Doe"
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="owner_1_ownership_pct" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Ownership % *</Label>
                        <Input
                          id="owner_1_ownership_pct"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={owner_1_ownership_pct}
                          onChange={(e) => set_owner_1_ownership_pct(e.target.value)}
                          className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
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
                      <div className="bg-emerald-50/20 p-8 rounded-[2rem] border border-emerald-50">
                        <h4 className="text-lg font-black text-emerald-950 uppercase tracking-tight mb-6">Owner 2</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="owner_2_name" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Full Name</Label>
                            <Input
                              id="owner_2_name"
                              value={owner_2_name}
                              onChange={(e) => set_owner_2_name(e.target.value)}
                              className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                              placeholder="Jane Smith"
                            />
                          </div>
                          <div>
                            <Label htmlFor="owner_2_ownership_pct" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Ownership %</Label>
                            <Input
                              id="owner_2_ownership_pct"
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={owner_2_ownership_pct}
                              onChange={(e) => set_owner_2_ownership_pct(e.target.value)}
                              className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Owner 3 */}
                      <div className="bg-emerald-50/20 p-8 rounded-[2rem] border border-emerald-50">
                        <h4 className="text-lg font-black text-emerald-950 uppercase tracking-tight mb-6">Owner 3</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="owner_3_name" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Full Name</Label>
                            <Input
                              id="owner_3_name"
                              value={owner_3_name}
                              onChange={(e) => set_owner_3_name(e.target.value)}
                              className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                              placeholder="Optional"
                            />
                          </div>
                          <div>
                            <Label htmlFor="owner_3_ownership_pct" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Ownership %</Label>
                            <Input
                              id="owner_3_ownership_pct"
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={owner_3_ownership_pct}
                              onChange={(e) => set_owner_3_ownership_pct(e.target.value)}
                              className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Owner 4 */}
                      <div className="bg-emerald-50/20 p-8 rounded-[2rem] border border-emerald-50">
                        <h4 className="text-lg font-black text-emerald-950 uppercase tracking-tight mb-6">Owner 4</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="owner_4_name" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Full Name</Label>
                            <Input
                              id="owner_4_name"
                              value={owner_4_name}
                              onChange={(e) => set_owner_4_name(e.target.value)}
                              className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                              placeholder="Optional"
                            />
                          </div>
                          <div>
                            <Label htmlFor="owner_4_ownership_pct" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Ownership %</Label>
                            <Input
                              id="owner_4_ownership_pct"
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={owner_4_ownership_pct}
                              onChange={(e) => set_owner_4_ownership_pct(e.target.value)}
                              className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Owner 5 */}
                      <div className="bg-emerald-50/20 p-8 rounded-[2rem] border border-emerald-50">
                        <h4 className="text-lg font-black text-emerald-950 uppercase tracking-tight mb-6">Owner 5</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="owner_5_name" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Full Name</Label>
                            <Input
                              id="owner_5_name"
                              value={owner_5_name}
                              onChange={(e) => set_owner_5_name(e.target.value)}
                              className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                              placeholder="Optional"
                            />
                          </div>
                          <div>
                            <Label htmlFor="owner_5_ownership_pct" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Ownership %</Label>
                            <Input
                              id="owner_5_ownership_pct"
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={owner_5_ownership_pct}
                              onChange={(e) => set_owner_5_ownership_pct(e.target.value)}
                              className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  <div className="flex flex-col sm:flex-row justify-between gap-4 pt-10">
                    <Button
                      onClick={() => set_step(3)}
                      variant="outline"
                      className="border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50 px-8 py-6 rounded-2xl font-black transition-all active:scale-95"
                    >
                      <ChevronLeft className="mr-2 w-5 h-5 text-emerald-600" />
                      Previous
                    </Button>
                    <Button
                      onClick={() => set_step(5)}
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black rounded-2xl px-10 py-6 shadow-xl shadow-emerald-500/20 transition-all active:scale-95"
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
                  <div className="bg-emerald-50/50 rounded-3xl p-8 mb-8">
                    <h3 className="text-xl font-black text-emerald-950 uppercase tracking-tighter mb-2">Credit & Special Situations</h3>
                    <p className="text-emerald-900/40 font-bold">Help us understand your credit situation and risk factors.</p>
                  </div>

                  {/* Credit Score Section */}
                  <div>
                    <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-4 block ml-1">Credit Score Range *</Label>
                    <div role="radiogroup" aria-label="Credit Score Range" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {CREDIT_SCORE_OPTIONS.map((opt) => (
                        <label
                          key={opt.value}
                          className={`flex items-center p-5 rounded-2xl border cursor-pointer transition-all duration-300 ${credit_score === opt.value ? "bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "bg-white border-emerald-50 text-emerald-950 hover:border-emerald-200"
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
                          <span className="text-sm font-black uppercase tracking-tight">{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Risk Assessment Questions */}
                  <div className="bg-emerald-50/50 rounded-3xl p-8 mb-8">
                    <h3 className="text-xl font-black text-emerald-950 uppercase tracking-tighter mb-2">
                      Risk Assessment Questions
                    </h3>
                    <p className="text-emerald-900/40 font-bold">Select all applicable risk factors and special situations.</p>

                    {/* Main risk assessment checkboxes - displayed in a grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
                      {/* Has existing loans checkbox */}
                      <div className="flex items-start space-x-3 p-4 bg-white/50 border border-emerald-50 rounded-2xl hover:bg-emerald-50 transition-all group">
                        <Checkbox
                          id="has_existing_loans"
                          checked={has_existing_loans}
                          onCheckedChange={(checked) => set_has_existing_loans(checked as boolean)}
                          className="mt-1"
                        />
                        <Label htmlFor="has_existing_loans" className="text-sm font-bold text-emerald-950 cursor-pointer">
                          Has existing loans or advances
                        </Label>
                      </div>

                      {/* Defaulted on MCA checkbox */}
                      <div className="flex items-start space-x-3 p-4 bg-white/50 border border-emerald-50 rounded-2xl hover:bg-emerald-50 transition-all group">
                        <Checkbox
                          id="has_defaulted_mca"
                          checked={has_defaulted_mca}
                          onCheckedChange={(checked) => set_has_defaulted_mca(checked as boolean)}
                          className="mt-1"
                        />
                        <Label htmlFor="has_defaulted_mca" className="text-sm font-bold text-emerald-950 cursor-pointer">
                          Defaulted on MCA
                        </Label>
                      </div>

                      {/* Reduced MCA payments checkbox */}
                      <div className="flex items-start space-x-3 p-4 bg-white/50 border border-emerald-50 rounded-2xl hover:bg-emerald-50 transition-all group">
                        <Checkbox
                          id="has_reduced_mca_payments"
                          checked={has_reduced_mca_payments}
                          onCheckedChange={(checked) => set_has_reduced_mca_payments(checked as boolean)}
                          className="mt-1"
                        />
                        <Label htmlFor="has_reduced_mca_payments" className="text-sm font-bold text-emerald-950 cursor-pointer">
                          Reduced MCA payments
                        </Label>
                      </div>

                      {/* Owns real estate checkbox */}
                      <div className="flex items-start space-x-3 p-4 bg-white/50 border border-emerald-50 rounded-2xl hover:bg-emerald-50 transition-all group">
                        <Checkbox
                          id="owns_real_estate"
                          checked={owns_real_estate}
                          onCheckedChange={(checked) => set_owns_real_estate(checked as boolean)}
                          className="mt-1"
                        />
                        <Label htmlFor="owns_real_estate" className="text-sm font-bold text-emerald-950 cursor-pointer">
                          Owns real estate
                        </Label>
                      </div>

                      {/* Personal CC debt over $75k checkbox */}
                      <div className="flex items-start space-x-3 p-4 bg-white/50 border border-emerald-50 rounded-2xl hover:bg-emerald-50 transition-all group">
                        <Checkbox
                          id="has_personal_debt_over_75k"
                          checked={has_personal_debt_over_75k}
                          onCheckedChange={(checked) => set_has_personal_debt_over_75k(checked as boolean)}
                          className="mt-1"
                        />
                        <Label htmlFor="has_personal_debt_over_75k" className="text-sm font-bold text-emerald-950 cursor-pointer">
                          Personal CC debt over $75k
                        </Label>
                      </div>
                    </div>

                    {/* ===== OPEN POSITIONS SECTION ===== */}
                    {/* Shown when client has existing loans — records each previous debt position */}
                    {has_existing_loans && (
                      <div className="mt-6 space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="text-base font-black text-emerald-950 uppercase tracking-tight">Open Positions</h4>
                            <p className="text-xs font-bold text-emerald-900/40 mt-0.5">Record each existing loan or advance (up to 5)</p>
                          </div>
                          <button
                            type="button"
                            onClick={add_position}
                            disabled={open_positions.length >= 5}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all active:scale-95"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Add Position
                          </button>
                        </div>

                        {open_positions.map((pos, idx) => {
                          const term_unit = LOAN_TYPE_DEFAULTS[pos.loan_type]?.term_unit ?? "remaining payments";
                          const lender_datalist_id = `lender-options-pos-${idx}`;
                          return (
                          <div key={idx} className="bg-white rounded-[1.5rem] border border-emerald-100 p-6 space-y-4 relative">
                            {/* Position header */}
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500">
                                Position {idx + 1}
                              </span>
                              {open_positions.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => remove_position(idx)}
                                  className="text-red-400 hover:text-red-600 transition-colors p-1 rounded-lg hover:bg-red-50"
                                  aria-label="Remove position"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Lender Name — datalist autocomplete from lender_guidelines, free text allowed */}
                              <div>
                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Lender *</Label>
                                <Input
                                  list={lender_datalist_id}
                                  value={pos.lender_name}
                                  onChange={(e) => update_position(idx, "lender_name", e.target.value)}
                                  className="h-12 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-5"
                                  placeholder="e.g. Chase, PayPal, OnDeck"
                                />
                                <datalist id={lender_datalist_id}>
                                  {lender_options.map((name) => (
                                    <option key={name} value={name} />
                                  ))}
                                </datalist>
                              </div>

                              {/* Loan Type */}
                              <div>
                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Type of Loan *</Label>
                                <Select
                                  value={pos.loan_type}
                                  onValueChange={(val) => set_position_loan_type(idx, val)}
                                >
                                  <SelectTrigger className="h-12 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-5">
                                    <SelectValue placeholder="Select type" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {LOAN_TYPES.map((type) => (
                                      <SelectItem key={type} value={type}>{type}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              {/* Initial Balance (optional) */}
                              <div>
                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">
                                  Initial Balance <span className="text-emerald-900/30 normal-case tracking-normal">(optional)</span>
                                </Label>
                                <div className="relative">
                                  <span className="absolute left-5 top-1/2 -translate-y-1/2 text-emerald-700 font-black text-sm">$</span>
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    min="0"
                                    value={pos.initial_balance}
                                    onChange={(e) => update_position(idx, "initial_balance", e.target.value)}
                                    className="h-12 pl-9 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold"
                                    placeholder="Original advance"
                                  />
                                </div>
                              </div>

                              {/* Current Balance */}
                              <div>
                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Current Balance *</Label>
                                <div className="relative">
                                  <span className="absolute left-5 top-1/2 -translate-y-1/2 text-emerald-700 font-black text-sm">$</span>
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    min="0"
                                    value={pos.current_balance}
                                    onChange={(e) => update_position(idx, "current_balance", e.target.value)}
                                    className="h-12 pl-9 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold"
                                    placeholder="0"
                                  />
                                </div>
                              </div>

                              {/* Payment Amount */}
                              <div>
                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Payment Amount *</Label>
                                <div className="relative">
                                  <span className="absolute left-5 top-1/2 -translate-y-1/2 text-emerald-700 font-black text-sm">$</span>
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    min="0"
                                    value={pos.payment_amount}
                                    onChange={(e) => update_position(idx, "payment_amount", e.target.value)}
                                    className="h-12 pl-9 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold"
                                    placeholder="0"
                                  />
                                </div>
                              </div>

                              {/* Payment Frequency */}
                              <div>
                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">Payment Frequency *</Label>
                                <Select
                                  value={pos.payment_frequency}
                                  onValueChange={(val) => update_position(idx, "payment_frequency", val)}
                                >
                                  <SelectTrigger className="h-12 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-5">
                                    <SelectValue placeholder="Select cadence" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {PAYMENT_FREQUENCIES.map((freq) => (
                                      <SelectItem key={freq} value={freq}>{freq}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              {/* Term Remaining (optional) */}
                              <div className="md:col-span-2">
                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">
                                  Term Remaining <span className="text-emerald-900/30 normal-case tracking-normal">(optional, in {term_unit})</span>
                                </Label>
                                <Input
                                  type="number"
                                  inputMode="numeric"
                                  step="1"
                                  min="0"
                                  value={pos.term_remaining}
                                  onChange={(e) => update_position(idx, "term_remaining", e.target.value)}
                                  className="h-12 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-5"
                                  placeholder={pos.loan_type ? `# of ${term_unit}` : "Select loan type first"}
                                />
                              </div>
                            </div>
                          </div>
                          );
                        })}

                        {open_positions.length >= 5 && (
                          <p className="text-xs font-bold text-emerald-900/40 text-center">Maximum of 5 positions reached</p>
                        )}
                      </div>
                    )}

                    {/* Conditional field: Show if client has defaulted on MCA */}
                    {has_defaulted_mca && (
                      <div className="mt-4 p-6 bg-emerald-50/50 rounded-2xl border border-emerald-50">
                        <div className="flex items-start space-x-3">
                          <Checkbox
                            id="mca_was_satisfied"
                            checked={mca_was_satisfied}
                            onCheckedChange={(checked) => set_mca_was_satisfied(checked as boolean)}
                            className="mt-1"
                          />
                          <Label htmlFor="mca_was_satisfied" className="text-sm font-bold text-emerald-950 cursor-pointer">
                            MCA was satisfied (debt has been paid off)
                          </Label>
                        </div>
                      </div>
                    )}

                    {/* Conditional field: Show if client has reduced MCA payments */}
                    {has_reduced_mca_payments && (
                      <div className="mt-4 p-6 bg-emerald-50/50 rounded-2xl border border-emerald-50">
                        <Label htmlFor="reduced_payments_months_ago" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">
                          How many months ago did payments reduce?
                        </Label>
                        <Input
                          id="reduced_payments_months_ago"
                          type="number"
                          value={reduced_payments_months_ago}
                          onChange={(e) => set_reduced_payments_months_ago(e.target.value ? Number(e.target.value) : "")}
                          className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                          placeholder="Number of months"
                        />
                      </div>
                    )}

                    {/* Conditional field: Show if client has personal CC debt over $75k */}
                    {has_personal_debt_over_75k && (
                      <div className="mt-4 p-6 bg-emerald-50/50 rounded-2xl border border-emerald-50">
                        <Label htmlFor="personal_cc_debt_amount" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">
                          Personal CC Debt Amount
                        </Label>
                        <div className="relative mt-2">
                          <span className="absolute left-6 top-1/2 -translate-y-1/2 text-emerald-950 font-black">$</span>
                          <Input
                            id="personal_cc_debt_amount"
                            type="number"
                            value={personal_cc_debt_amount}
                            onChange={(e) => set_personal_cc_debt_amount(e.target.value ? Number(e.target.value) : "")}
                            className="h-14 pl-10 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold"
                            placeholder="Amount"
                          />
                        </div>
                      </div>
                    )}

                    {/* Bankruptcy/Foreclosure checkbox */}
                    <div className="grid grid-cols-1 gap-3 mt-3">
                      <div className="flex items-start space-x-3 p-4 bg-white/50 border border-emerald-50 rounded-2xl hover:bg-emerald-50 transition-all group">
                        <Checkbox
                          id="has_bankruptcy_foreclosure_3y"
                          checked={has_bankruptcy_foreclosure_3y}
                          onCheckedChange={(checked) => set_has_bankruptcy_foreclosure_3y(checked as boolean)}
                          className="mt-1"
                        />
                        <Label htmlFor="has_bankruptcy_foreclosure_3y" className="text-sm font-bold text-emerald-950 cursor-pointer">
                          Foreclosures or bankruptcies in past 3 years
                        </Label>
                      </div>
                    </div>

                    {/* Conditional fields: Show if client has bankruptcy/foreclosure */}
                    {has_bankruptcy_foreclosure_3y && (
                      <div className="mt-4 p-6 bg-emerald-50/50 rounded-2xl border border-emerald-50 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Months ago field */}
                          <div>
                            <Label htmlFor="bk_fc_months_ago" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">
                              How many months ago?
                            </Label>
                            <Input
                              id="bk_fc_months_ago"
                              type="number"
                              value={bk_fc_months_ago}
                              onChange={(e) => set_bk_fc_months_ago(e.target.value ? Number(e.target.value) : "")}
                              className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                              placeholder="Months"
                            />
                          </div>
                          {/* Type selection field */}
                          <div>
                            <Label htmlFor="bk_fc_type" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">
                              Type
                            </Label>
                            <Select value={bk_fc_type} onValueChange={set_bk_fc_type}>
                              <SelectTrigger className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6">
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
                      <div className="flex items-start space-x-3 p-4 bg-white/50 border border-emerald-50 rounded-2xl hover:bg-emerald-50 transition-all group">
                        <Checkbox
                          id="has_tax_liens"
                          checked={has_tax_liens}
                          onCheckedChange={(checked) => set_has_tax_liens(checked as boolean)}
                          className="mt-1"
                        />
                        <Label htmlFor="has_tax_liens" className="text-sm font-bold text-emerald-950 cursor-pointer">
                          Tax liens
                        </Label>
                      </div>
                    </div>

                    {/* Conditional fields: Show if client has tax liens */}
                    {has_tax_liens && (
                      <div className="mt-4 p-6 bg-emerald-50/50 rounded-2xl border border-emerald-50 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Tax lien type selection */}
                          <div>
                            <Label htmlFor="tax_liens_type" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">
                              Tax lien type
                            </Label>
                            <Select value={tax_liens_type} onValueChange={set_tax_liens_type}>
                              <SelectTrigger className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6">
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
                            <Label htmlFor="tax_liens_amount" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">
                              Tax lien amount
                            </Label>
                            <div className="relative mt-2">
                              <span className="absolute left-6 top-1/2 -translate-y-1/2 text-emerald-950 font-black">$</span>
                              <Input
                                id="tax_liens_amount"
                                type="number"
                                value={tax_liens_amount}
                                onChange={(e) => set_tax_liens_amount(e.target.value ? Number(e.target.value) : "")}
                                className="h-14 pl-10 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold"
                                placeholder="Amount"
                              />
                            </div>
                          </div>
                        </div>
                        {/* Payment plan checkbox */}
                        <div className="flex items-start space-x-3 p-4 bg-white/50 border border-emerald-50 rounded-2xl hover:bg-emerald-50 transition-all group">
                          <Checkbox
                            id="tax_liens_on_plan"
                            checked={tax_liens_on_plan}
                            onCheckedChange={(checked) => set_tax_liens_on_plan(checked as boolean)}
                            className="mt-1"
                          />
                          <Label htmlFor="tax_liens_on_plan" className="text-sm font-bold text-emerald-950 cursor-pointer">
                            On payment plan
                          </Label>
                        </div>
                      </div>
                    )}

                    {/* Judgements checkbox */}
                    <div className="grid grid-cols-1 gap-3 mt-3">
                      <div className="flex items-start space-x-3 p-4 bg-white/50 border border-emerald-50 rounded-2xl hover:bg-emerald-50 transition-all group">
                        <Checkbox
                          id="has_active_judgements"
                          checked={has_active_judgements}
                          onCheckedChange={(checked) => set_has_active_judgements(checked as boolean)}
                          className="mt-1"
                        />
                        <Label htmlFor="has_active_judgements" className="text-sm font-bold text-emerald-950 cursor-pointer">
                          Judgements
                        </Label>
                      </div>
                    </div>

                    {/* Conditional field: Show if client has judgements */}
                    {has_active_judgements && (
                      <div className="mt-4 p-6 bg-emerald-50/50 rounded-2xl border border-emerald-50">
                        <Label htmlFor="judgements_explain" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">
                          Explain
                        </Label>
                        <Textarea
                          id="judgements_explain"
                          value={judgements_explain}
                          onChange={(e) => set_judgements_explain(e.target.value)}
                          className="rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold p-6"
                          placeholder="Explain any judgements..."
                          rows={3}
                        />
                      </div>
                    )}

                    {/* ZBL (Zero Balance Letter) checkbox */}
                    <div className="grid grid-cols-1 gap-3 mt-3">
                      <div className="flex items-start space-x-3 p-4 bg-white/50 border border-emerald-50 rounded-2xl hover:bg-emerald-50 transition-all group">
                        <Checkbox
                          id="has_zbl"
                          checked={has_zbl}
                          onCheckedChange={(checked) => set_has_zbl(checked as boolean)}
                          className="mt-1"
                        />
                        <Label htmlFor="has_zbl" className="text-sm font-bold text-emerald-950 cursor-pointer">
                          Has ZBL (Zero Balance Letter)
                        </Label>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row justify-between gap-4 pt-6">
                    <Button
                      onClick={() => set_step(4)}
                      variant="outline"
                      className="border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50 px-8 py-6 rounded-2xl font-black transition-all active:scale-95"
                    >
                      <ChevronLeft className="mr-2 w-5 h-5 text-emerald-600" />
                      Previous
                    </Button>
                    <Button
                      onClick={() => set_step(6)}
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black rounded-2xl px-10 py-6 shadow-xl shadow-emerald-500/20 transition-all active:scale-95"
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
                  <div className="bg-emerald-50/50 rounded-3xl p-8 mb-8">
                    <h3 className="text-xl font-black text-emerald-950 uppercase tracking-tighter mb-2">Final Details</h3>
                    <p className="text-emerald-900/40 font-bold">Just a few more details and you're done!</p>
                  </div>

                  <div>
                    <Label htmlFor="funding_eta" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-3 block ml-1">How soon do they need funds? *</Label>
                    <Select value={funding_eta} onValueChange={set_funding_eta}>
                      <SelectTrigger className="max-w-xs h-12 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6">
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
                    <Label htmlFor="additional_notes" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-3 block ml-1">Additional Information *</Label>
                    <Textarea
                      id="additional_notes"
                      value={additional_notes}
                      onChange={(e) => set_additional_notes(e.target.value)}
                      className="rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold p-6"
                      placeholder="Any additional information we should know..."
                      rows={5}
                      required
                    />
                  </div>

                  {/* Manual Funding Application Upload - Only show in Advisor Context */}
                  {is_advisor_context && (
                    <div className="bg-emerald-50/50 rounded-3xl p-8 mb-8 border border-emerald-100">
                      <div className="flex items-start space-x-3 mb-4">
                        <Checkbox
                          id="has_already_signed"
                          checked={has_already_signed}
                          onCheckedChange={(checked) => set_has_already_signed(checked as boolean)}
                        />
                        <Label htmlFor="has_already_signed" className="text-sm font-bold text-emerald-950 cursor-pointer">
                          Client has already signed a Funding Application outside the vault
                        </Label>
                      </div>

                      {has_already_signed && (
                        <div className="space-y-4 animate-fade-in">
                          <Label htmlFor="signed_document" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 block ml-1">
                            Upload Signed Application (PDF) *
                          </Label>
                          <Input
                            id="signed_document"
                            type="file"
                            accept=".pdf"
                            onChange={(e) => set_signed_document_file(e.target.files?.[0] || null)}
                            className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6 py-3 cursor-pointer"
                            required={has_already_signed}
                          />
                          <p className="text-[10px] font-bold text-emerald-600/60 ml-1 italic">
                            * The vault will be marked as completed and the document will be synced.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Documents Requested Section */}
                  {/* This section tracks which documents need to be collected from the client */}
                  {/* Each selected document will generate a "requested_{doc_name}" tag in GHL */}
                  <div className="space-y-4">
                    <div className="bg-emerald-50/50 rounded-3xl p-8 mb-4">
                      <h3 className="text-xl font-black text-emerald-950 uppercase tracking-tighter mb-2">Documents Requested</h3>
                      <p className="text-emerald-900/40 font-bold">
                        Select all documents that need to be collected from this client.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-white/50 p-6 md:p-8 rounded-[2.5rem] border border-emerald-50">
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
                          <div className="flex-1">
                            <Label
                              htmlFor={`doc-${doc}`}
                              className="text-sm text-emerald-950 cursor-pointer leading-tight font-bold"
                            >
                              {doc}
                            </Label>
                            {doc === "Business Bank Statements" && documents_requested.includes(doc) && (
                              <select
                                value={statement_months}
                                onChange={(e) => set_statement_months(parseInt(e.target.value))}
                                className="mt-2 block text-xs font-bold border border-emerald-100 rounded-md px-2 py-1 bg-white text-emerald-950"
                              >
                                {[6, 12, 18, 24].map((m) => (
                                  <option key={m} value={m}>{m} months</option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Selected count, or a required-warning when none are picked.
                        At least one document is mandatory — handle_submit blocks
                        creation otherwise, so surface the requirement here too. */}
                    {documents_requested.length > 0 ? (
                      <div className="bg-emerald-500 rounded-2xl p-4 text-center">
                        <p className="text-sm font-black uppercase tracking-widest text-white">
                          {documents_requested.length} document{documents_requested.length !== 1 ? 's' : ''} requested
                        </p>
                      </div>
                    ) : (
                      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
                        <p className="text-sm font-black uppercase tracking-widest text-red-900">
                          Select at least one document — required to create the client
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Advisor Selection - Only show if NOT an advisor (advisors are auto-assigned) */}
                  {!is_advisor_context && (
                    <div className="space-y-4 mt-8 pt-8 border-t border-emerald-50">
                      <h3 className="text-xl font-black text-emerald-950 uppercase tracking-tighter">Advisor Assignment *</h3>
                      <p className="text-sm font-bold text-emerald-900/40">Select the advisor who will work with this client.</p>
                      {loading_advisors ? (
                        <div className="text-sm text-gray-500">Loading advisors...</div>
                      ) : advisors.length === 0 ? (
                        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
                          No active advisors found
                        </div>
                      ) : (
                        <Select value={advisor_id} onValueChange={set_advisor_id}>
                          <SelectTrigger className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6">
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
                        <div className="bg-emerald-500 rounded-3xl p-8 text-white shadow-xl shadow-emerald-500/20">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60 mb-4">Selected Advisor</p>
                          {(() => {
                            const selected = advisors.find(a => a.id === advisor_id);
                            return selected ? (
                              <div className="space-y-2">
                                <p className="text-xl font-black uppercase tracking-tight">{selected.first_name} {selected.last_name}</p>
                                <p className="font-bold opacity-80">{selected.email}</p>
                              </div>
                            ) : null;
                          })()}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Followers — additional advisors who should receive every email this client gets */}
                  {is_advisor_context && !loading_advisors && (
                    <div className="mt-8 pt-8 border-t border-emerald-50">
                      <FollowersPicker
                        advisors={advisors}
                        selectedIds={follower_advisor_ids}
                        excludeIds={advisor_id ? [advisor_id] : []}
                        onAdd={(id) => toggle_follower(id)}
                        onRemove={(id) => toggle_follower(id)}
                      />
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row justify-between gap-4 pt-10 border-t border-emerald-50">
                    <Button
                      onClick={() => set_step(5)}
                      variant="outline"
                      className="border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50 px-8 py-6 rounded-2xl font-black transition-all active:scale-95"
                    >
                      <ChevronLeft className="mr-2 w-5 h-5 text-emerald-600" />
                      Previous
                    </Button>
                    <Button
                      onClick={handle_submit}
                      disabled={submitting}
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black rounded-2xl px-12 py-6 shadow-xl shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-50"
                    >
                      {submitting ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-3"></div>
                          Processing...
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