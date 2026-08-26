// src/components/profile-display.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

// ============================================
// TYPE DEFINITIONS
// Define the structure of data we'll work with
// ============================================

// component-state-enum: Enum for different component states
enum ComponentState {
  LOADING = "LOADING",
  ERROR = "ERROR",
  SUCCESS = "SUCCESS",
  NO_DATA = "NO_DATA",
}

// profile-field: Structure for each field to display
type ProfileField = {
  label: string;
  value: string;
};

// vault-data: Structure for client_data_vault data
// Only includes the 6 fields we want to display
type VaultData = {
  company_name: string;           // Client's business name (heading)
  capital_requested: number;      // Funding goal (amount requested)
  legal_entity_type: string;      // Type of entity
  business_start_date: string;    // Business start date
  avg_monthly_deposits: number;   // Monthly revenue
  credit_score: string;           // Credit score
  industry: string;               // Industry
};

/**
 * ProfileDisplay Component
 * 
 * Displays simplified client profile information from client_data_vault table.
 * Shows only 6 key fields in a grid layout.
 * 
 * DATABASE SCHEMA FLOW:
 * 1. auth.users → Current authenticated user
 * 2. client_data_vault → Client's vault data (user_id → auth.users.id)
 * 
 * FIELDS DISPLAYED:
 * 1. Funding goal (capital_requested - formatted as currency)
 * 2. Type of entity (legal_entity_type)
 * 3. Industry (industry)
 * 4. Business start date (business_start_date)
 * 5. Monthly revenue (avg_monthly_deposits)
 * 6. Credit score (credit_score)
 * 
 * @returns Profile information card based on current state
 */
/**
 * "full" is the original three-across card of big tiles; "rail" is the client
 * portal sidebar version — the same six fields as a compact label/value list
 * sized for a ~320px column. One component, because the vault fetch and its
 * four load states are the part worth not duplicating.
 */
type ProfileVariant = "full" | "rail";

export default function ProfileDisplay({
  onLoad,
  variant = "full",
}: {
  onLoad?: () => void;
  variant?: ProfileVariant;
}) {
  // ============================================
  // STATE MANAGEMENT
  // Using enum for better state control
  // ============================================

  // supabase-client: Database client for queries
  const supabase = createClient();

  // component-state: Single source of truth for component state
  const [component_state, set_component_state] = useState<ComponentState>(
    ComponentState.LOADING
  );

  // vault-data-state: Stores fetched vault information
  const [vault_data, set_vault_data] = useState<VaultData | null>(null);

  // error-message-state: Stores specific error message
  const [error_message, set_error_message] = useState<string>("");

  useEffect(() => {
    if (component_state !== ComponentState.LOADING) {
      onLoad?.();
    }
  }, [component_state, onLoad]);

  // ============================================
  // FETCH PROFILE DATA ON MOUNT
  // Runs once when component loads
  // ============================================
  useEffect(() => {
    /**
     * fetch-profile-data: Main async function to retrieve profile data
     * 
     * This function executes a 2-step database query:
     * Step 1: Authenticate current user
     * Step 2: Get user's client_data_vault record (only needed fields)
     */
    async function fetch_profile_data() {
      try {
        set_component_state(ComponentState.LOADING);

        // ============================================
        // STEP 1: AUTHENTICATION
        // Get the currently logged-in user from Supabase Auth
        // ============================================
        const { data: { user }, error: user_error } = await supabase.auth.getUser();

        // user-error-handling: Check for authentication errors
        if (user_error) {
          console.error("❌ Authentication error:", user_error);
          set_error_message("Authentication failed. Please try logging in again.");
          set_component_state(ComponentState.ERROR);
          return;
        }

        // user-null-check: Ensure user exists
        if (!user) {
          console.warn("⚠️ No authenticated user found");
          set_error_message("Please log in to view your profile information.");
          set_component_state(ComponentState.ERROR);
          return;
        }

        console.log("✅ User authenticated successfully");
        console.log("   User ID:", user.id);

        // ============================================
        // STEP 2: GET CLIENT DATA VAULT RECORD
        // Query: client_data_vault WHERE user_id = auth.users.id
        // Returns: Only the 5 fields needed for display (industry not available)
        // ============================================
        const { data: vault, error: vault_error } = await supabase
          .from("client_data_vault")
          .select(`
            company_name,
            capital_requested,
            legal_entity_type,
            business_start_date,
            avg_monthly_deposits,
            credit_score,
            industry
          `)
          .eq("user_id", user.id)
          .maybeSingle(); // ✅ Returns null if 0 rows, prevents PGRST116 error

        // vault-error-handling: Check for database errors
        if (vault_error) {
          console.error("❌ Client data vault query error:", vault_error);
          set_error_message("Error loading your profile data. Please contact support.");
          set_component_state(ComponentState.ERROR);
          return;
        }

        // vault-null-check: Ensure vault record exists
        if (!vault) {
          console.warn("⚠️ No client data vault found for user:", user.id);
          set_error_message("No profile data found. Please complete your vault setup.");
          set_component_state(ComponentState.ERROR);
          return;
        }

        console.log("✅ Profile data loaded successfully");
        console.log("   Funding amount:", format_currency(vault.capital_requested));
        console.log("   Legal entity:", vault.legal_entity_type);

        // success-state-update: Store vault data and update state
        set_vault_data(vault);
        set_component_state(ComponentState.SUCCESS);

      } catch (err: any) {
        // unexpected-error-handler: Catch any unexpected errors
        console.error("❌ Unexpected error in fetch_profile_data:", err);
        set_error_message(err.message || "An unexpected error occurred. Please try refreshing the page.");
        set_component_state(ComponentState.ERROR);
      }
    }

    // execute-fetch: Run the fetch function
    fetch_profile_data();
  }, []); // empty-deps: Run once on component mount

  // ============================================
  // HELPER FUNCTIONS
  // Utility functions for data formatting
  // ============================================

  /**
   * format-currency: Format number as USD currency
   * @param amount - Number to format
   * @returns Formatted currency string (e.g., "$50,000")
   */
  const format_currency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  /**
   * format-date: Format date string for display
   * @param date_string - ISO date string
   * @returns Formatted date (e.g., "Jan 15, 2020")
   */
  const format_date = (date_string: string): string => {
    return new Date(date_string).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  /**
   * build-profile-fields: Convert vault data to display fields
   * Maps client_data_vault columns to user-friendly labels
   * 
   * @param vault - Vault data from database
   * @returns Array of 6 field objects for display
   */
  const build_profile_fields = (vault: VaultData): ProfileField[] => {
    return [
      // funding-goal: Capital amount requested (formatted as currency)
      {
        label: "Funding goal",
        value: vault.capital_requested
          ? format_currency(vault.capital_requested)
          : "—"
      },

      // entity-type: Legal structure of the business
      {
        label: "Type of entity",
        value: vault.legal_entity_type || "—"
      },


      {
        label: "Industry",
        value: vault.industry || "—"
      },

      // start-date: When the business was established
      {
        label: "Business start date",
        value: vault.business_start_date
          ? format_date(vault.business_start_date)
          : "—"
      },

      // monthly-revenue: Average monthly deposits/revenue
      {
        label: "Monthly revenue",
        value: vault.avg_monthly_deposits
          ? format_currency(vault.avg_monthly_deposits)
          : "—"
      },

      // credit-score: Client's credit score range
      {
        label: "Credit score",
        value: vault.credit_score || "—"
      },
    ];
  };

  // ============================================
  // RENDER COMPONENTS
  // Helper functions for each render state
  // ============================================

  /**
   * render-loading-state: Loading skeleton component
   * Shows simple loading message while fetching data
   */
  const render_loading_state = () => {
    return (
      <Card className="bg-white/80 border-emerald-50 rounded-[2.5rem] shadow-sm overflow-hidden">
        <CardHeader className="p-10 pb-4">
          <CardTitle className="text-2xl font-black text-emerald-950 uppercase tracking-tighter">Your Profile</CardTitle>
          <CardDescription className="text-emerald-900/60 text-lg font-bold mt-2">
            Basic information used for your application
          </CardDescription>
        </CardHeader>
        <CardContent className="p-10 pt-4">
          <div className="text-emerald-900/40 font-bold animate-pulse">Loading profile…</div>
        </CardContent>
      </Card>
    );
  };

  /**
   * render-error-state: Error message component
   * Shows user-friendly error message with icon
   */
  const render_error_state = () => {
    return (
      <Card className="bg-white/80 border-emerald-50 rounded-[2.5rem] shadow-sm overflow-hidden">
        <CardHeader className="p-10 pb-4">
          <CardTitle className="text-2xl font-black text-emerald-950 uppercase tracking-tighter">Your Profile</CardTitle>
          <CardDescription className="text-emerald-900/60 text-lg font-bold mt-2">
            Basic information used for your application
          </CardDescription>
        </CardHeader>
        <CardContent className="p-10 pt-4">
          <div className="bg-red-50 border border-red-100 rounded-3xl p-6">
            <div className="flex items-start gap-4">
              <AlertCircle className="h-6 w-6 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-red-900 text-base font-black tracking-tight uppercase mb-1">
                  Unable to Load Profile
                </p>
                <p className="text-red-700 text-sm font-bold">
                  {error_message}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  /**
   * render-success-state: Full profile information component
   * Shows 6 profile fields in a responsive grid
   */
  const render_success_state = () => {
    if (!vault_data) {
      return render_error_state();
    }

    const fields = build_profile_fields(vault_data);

    return (
      <Card id="tour-profile" className="bg-white/80 border-emerald-50 rounded-[2.5rem] shadow-sm overflow-hidden backdrop-blur-sm transition-all duration-500 hover:shadow-xl">
        <CardHeader className="p-10 pb-4">
          {/* The company name is the heading — a client landing here wants to see
              their own business named back to them, not a generic label. The
              "Your Profile" eyebrow keeps the section identifiable, and the
              vault always has company_name (NOT NULL), so the fallback is
              defensive only. */}
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2">
            Your Profile
          </div>
          <CardTitle className="text-3xl font-black text-emerald-950 uppercase tracking-tighter">
            {vault_data.company_name || "Your Profile"}
          </CardTitle>
          <CardDescription className="text-emerald-900/60 text-lg font-bold mt-2">
            Used by underwriting to review your business and funding goals. This information helps move your application forward.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-10 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {fields.map((field) => (
              <div
                key={field.label}
                className="rounded-3xl border border-emerald-50 p-6 bg-white transition-all hover:border-emerald-200 group"
              >
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 mb-2 group-hover:text-emerald-500 transition-colors">
                  {field.label}
                </div>
                <div className="text-emerald-950 font-black text-xl tracking-tight">
                  {field.value}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  };

  // ── Rail variant ──────────────────────────────────────────────────────────
  //
  // #tour-profile sits on the shell, not the success state, so the anchor
  // resolves while the vault row is still loading — the tour auto-runs on a
  // client's first visit and would otherwise skip a step on a slow fetch.
  const render_rail = () => {
    const fields = vault_data ? build_profile_fields(vault_data) : [];

    return (
      <section
        id="tour-profile"
        className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm"
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cb-gray">
          Your business
        </p>

        {component_state === ComponentState.LOADING && (
          <div className="mt-4 animate-pulse space-y-2">
            <div className="h-4 w-32 rounded bg-black/5" />
            <div className="h-3 w-full rounded bg-black/5" />
            <div className="h-3 w-4/5 rounded bg-black/5" />
          </div>
        )}

        {component_state !== ComponentState.LOADING && !vault_data && (
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-amber-50 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-xs leading-relaxed text-amber-800">{error_message}</p>
          </div>
        )}

        {vault_data && (
          <>
            <h3 className="mt-2 font-manrope text-lg font-extrabold leading-tight tracking-tight text-cb-ink">
              {vault_data.company_name || "Your business"}
            </h3>
            <dl className="mt-4 space-y-2.5 border-t border-black/5 pt-4">
              {fields.map((field) => (
                <div key={field.label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-[11px] font-medium text-cb-ink/45">{field.label}</dt>
                  <dd className="text-right text-[13px] font-semibold text-cb-ink">
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>
    );
  };

  if (variant === "rail") return render_rail();

  // ============================================
  // MAIN RENDER WITH SWITCH STATEMENT
  // Clean switch-based rendering
  // ============================================
  switch (component_state) {
    case ComponentState.LOADING:
      return render_loading_state();

    case ComponentState.ERROR:
      return render_error_state();

    case ComponentState.SUCCESS:
      return render_success_state();

    case ComponentState.NO_DATA:
      return null;

    default:
      console.error("❌ Unknown component state:", component_state);
      return render_error_state();
  }
}