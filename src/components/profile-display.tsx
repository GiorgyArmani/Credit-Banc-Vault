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
  capital_requested: number;      // Funding goal (amount requested)
  legal_entity_type: string;      // Type of entity
  business_start_date: string;    // Business start date
  avg_monthly_deposits: number;   // Monthly revenue
  credit_score: string;           // Credit score
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
 * 3. Industry (not in client_data_vault - shows "—")
 * 4. Business start date (business_start_date)
 * 5. Monthly revenue (avg_monthly_deposits)
 * 6. Credit score (credit_score)
 * 
 * @returns Profile information card based on current state
 */
export default function ProfileDisplay() {
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
            capital_requested,
            legal_entity_type,
            business_start_date,
            avg_monthly_deposits,
            credit_score
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
      
      // industry: Business industry category
      // NOTE: Industry field is not in client_data_vault table
      // Showing placeholder until industry is added to the schema
      { 
        label: "Industry", 
        value: "—" 
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
      <Card className="bg-white/90 border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-900">Your Profile</CardTitle>
          <CardDescription className="text-slate-600">
            Basic information used for your application
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* loading-message: Simple loading text */}
          <div className="text-slate-500">Loading profile…</div>
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
      <Card className="bg-white/90 border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-900">Your Profile</CardTitle>
          <CardDescription className="text-slate-600">
            Basic information used for your application
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* error-container: Styled error message box */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              {/* error-icon: Warning triangle icon */}
              <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                {/* error-title: Bold error heading */}
                <p className="text-amber-800 text-sm font-medium mb-1">
                  Unable to Load Profile
                </p>
                {/* error-message: Specific error details */}
                <p className="text-amber-700 text-xs">
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
    // safety-check: Ensure vault data exists
    if (!vault_data) {
      return render_error_state();
    }

    // build-fields: Convert vault data to display fields
    const fields = build_profile_fields(vault_data);

    return (
      <Card className="bg-white/90 border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-900">Your Profile</CardTitle>
          <CardDescription className="text-slate-600">
            Basic information used for your application
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* profile-grid: Responsive grid of profile fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {fields.map((field) => (
              // field-card: Individual field display card
              <div 
                key={field.label} 
                className="rounded-lg border p-3 bg-white"
              >
                {/* field-label: Small uppercase label */}
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  {field.label}
                </div>
                {/* field-value: Bold value display */}
                <div className="text-slate-900 font-medium">
                  {field.value}
                </div>
              </div>
            ))}
          </div>

          {/* optional-edit-button: Commented out for future use */}
          {/* <div className="mt-4">
            <Button variant="outline">Edit profile</Button>
          </div> */}
        </CardContent>
      </Card>
    );
  };

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
      // exhaustive-check: TypeScript ensures all cases are handled
      console.error("❌ Unknown component state:", component_state);
      return render_error_state();
  }
}