// src/components/advisor-display.tsx
"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Mail, Phone, User, AlertCircle } from "lucide-react";

// ============================================
// TYPE DEFINITIONS
// Define the structure of data we'll work with
// ============================================

// component-state-enum: Enum for different component states
// Provides type-safe state management and cleaner switch statements
enum ComponentState {
  LOADING = "LOADING",
  ERROR = "ERROR",
  SUCCESS = "SUCCESS",
  NO_DATA = "NO_DATA",
}

// advisor-info: Structure for advisor data from public.advisors table
// Matches the advisors table schema exactly
type AdvisorInfo = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  profile_pic_url: string | null;
};

/**
 * AdvisorDisplay Component
 * 
 * Displays the advisor assigned to the current client on their vault dashboard.
 * Shows advisor's profile picture, name, email, phone, and contact buttons.
 * 
 * DATABASE SCHEMA FLOW:
 * 1. auth.users → Current authenticated user
 * 2. client_data_vault → Client's vault data (user_id → auth.users.id)
 * 3. advisors → Advisor details (id → client_data_vault.advisor_id)
 * 
 * ARCHITECTURE IMPROVEMENTS:
 * - Uses enum-based state management instead of multiple boolean flags
 * - Switch statement for rendering instead of nested if statements
 * - Cleaner separation of concerns with render functions
 * - Better TypeScript type safety
 * 
 * @returns {JSX.Element} Advisor information card based on current state
 */
export default function AdvisorDisplay(): React.ReactElement {
  // ============================================
  // STATE MANAGEMENT
  // Using enum for better state control
  // ============================================
  
  // supabase-client: Database client for queries
  const supabase = createClient();
  
  // component-state: Single source of truth for component state
  // Uses enum instead of multiple boolean flags
  const [component_state, set_component_state] = useState<ComponentState>(
    ComponentState.LOADING
  );
  
  // advisor-state: Stores fetched advisor information
  const [advisor, setAdvisor] = useState<AdvisorInfo | null>(null);
  
  // error-message-state: Stores specific error message
  const [error_message, set_error_message] = useState<string>("");

  // ============================================
  // FETCH ADVISOR DATA ON MOUNT
  // Runs once when component loads
  // ============================================
  useEffect(() => {
    /**
     * fetch-advisor-info: Main async function to retrieve advisor data
     * 
     * This function executes a 3-step database query chain:
     * Step 1: Authenticate current user
     * Step 2: Get user's client_data_vault record (contains advisor_id)
     * Step 3: Get advisor details from advisors table
     * 
     * Uses early returns for error handling (clean pattern)
     */
    async function fetch_advisor_info() {
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
          set_error_message("Please log in to view your advisor information.");
          set_component_state(ComponentState.ERROR);
          return;
        }

        console.log("✅ User authenticated successfully");
        console.log("   User ID:", user.id);

        // ============================================
        // STEP 2: GET CLIENT DATA VAULT RECORD
        // Query: client_data_vault WHERE user_id = auth.users.id
        // Schema: client_data_vault.user_id → auth.users.id (UNIQUE constraint)
        // Returns: advisor_id (and optionally advisor_name for caching)
        // ============================================
        const { data: vault_data, error: vault_error } = await supabase
          .from("client_data_vault")
          .select("id, advisor_id, advisor_name")
          .eq("user_id", user.id)
          .maybeSingle(); // ✅ Returns null if 0 rows, prevents PGRST116 error
        
        // vault-error-handling: Check for database errors
        if (vault_error) {
          console.error("❌ Client data vault query error:", vault_error);
          set_error_message("Error loading your vault data. Please contact support.");
          set_component_state(ComponentState.ERROR);
          return;
        }
        
        // vault-null-check: Ensure vault record exists
        if (!vault_data) {
          console.warn("⚠️ No client data vault found for user:", user.id);
          set_error_message("No vault data found. Please complete your vault setup.");
          set_component_state(ComponentState.ERROR);
          return;
        }

        console.log("✅ Client data vault found");
        console.log("   Vault ID:", vault_data.id);
        console.log("   Advisor ID:", vault_data.advisor_id || "Not assigned");
        if (vault_data.advisor_name) {
          console.log("   Advisor Name (cached):", vault_data.advisor_name);
        }

        // advisor-id-null-check: Ensure advisor_id exists in vault
        if (!vault_data.advisor_id) {
          console.warn("⚠️ No advisor assigned in vault record");
          set_error_message("No advisor has been assigned to your account yet. An advisor will be assigned soon.");
          set_component_state(ComponentState.ERROR);
          return;
        }

        // ============================================
        // STEP 3: FETCH ADVISOR DETAILS
        // Query: advisors WHERE id = client_data_vault.advisor_id
        // Schema: advisors.id is the primary key
        // Returns: Full advisor profile information
        // ============================================
        const { data: advisor_data, error: advisor_error } = await supabase
          .from("advisors")
          .select("id, first_name, last_name, email, phone, profile_pic_url")
          .eq("id", vault_data.advisor_id)
          .maybeSingle(); // ✅ Returns null if advisor not found
        
        // advisor-error-handling: Check for database errors
        if (advisor_error) {
          console.error("❌ Advisor query error:", advisor_error);
          set_error_message("Error loading advisor information. Please contact support.");
          set_component_state(ComponentState.ERROR);
          return;
        }
        
        // advisor-null-check: Ensure advisor exists
        if (!advisor_data) {
          console.error("❌ Advisor not found for ID:", vault_data.advisor_id);
          set_error_message("Advisor information not found. The assigned advisor may have been removed. Please contact support.");
          set_component_state(ComponentState.ERROR);
          return;
        }

        console.log("✅ Advisor data loaded successfully");
        console.log("   Advisor:", advisor_data.first_name, advisor_data.last_name);
        console.log("   Email:", advisor_data.email);
        console.log("   Phone:", advisor_data.phone || "Not provided");
        
        // success-state-update: Store advisor data and update state
        setAdvisor(advisor_data);
        set_component_state(ComponentState.SUCCESS);
        
      } catch (err: any) {
        // unexpected-error-handler: Catch any unexpected errors
        console.error("❌ Unexpected error in fetch_advisor_info:", err);
        set_error_message(err.message || "An unexpected error occurred. Please try refreshing the page.");
        set_component_state(ComponentState.ERROR);
      }
    }

    // execute-fetch: Run the fetch function
    fetch_advisor_info();
  }, []); // empty-deps: Run once on component mount

  // ============================================
  // HELPER FUNCTIONS
  // Utility functions for rendering
  // ============================================
  
  /**
   * get-initials: Extract first letter of first and last name
   * Used as fallback avatar when no profile picture exists
   * 
   * @param first_name - Advisor's first name
   * @param last_name - Advisor's last name
   * @returns Two uppercase letters (e.g., "JD" for John Doe)
   */
  const get_initials = (first_name: string, last_name: string): string => {
    return `${first_name.charAt(0)}${last_name.charAt(0)}`.toUpperCase();
  };

  // ============================================
  // RENDER COMPONENTS
  // Helper functions for each render state
  // ============================================

  /**
   * render-loading-state: Loading skeleton component
   * Shows animated placeholder while fetching data
   */
  const render_loading_state = (): React.ReactElement => {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Your Advisor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            {/* skeleton-animation: Pulsing placeholder */}
            <div className="animate-pulse flex space-x-4">
              {/* avatar-skeleton: Circle placeholder for profile picture */}
              <div className="rounded-full bg-slate-200 h-16 w-16"></div>
              <div className="flex-1 space-y-3 py-1">
                {/* text-skeleton: Line placeholders for text */}
                <div className="h-4 bg-slate-200 rounded w-32"></div>
                <div className="h-3 bg-slate-200 rounded w-48"></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  /**
   * render-error-state: Error message component
   * Shows user-friendly error message with icon
   */
  const render_error_state = (): React.ReactElement => {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Your Advisor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            {/* error-container: Styled error message box */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                {/* error-icon: Warning triangle icon */}
                <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 text-left">
                  {/* error-title: Bold error heading */}
                  <p className="text-amber-800 text-sm font-medium mb-1">
                    Unable to Load Advisor
                  </p>
                  {/* error-message: Specific error details */}
                  <p className="text-amber-700 text-xs">
                    {error_message}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  /**
   * render-success-state: Full advisor information component
   * Shows complete advisor profile with contact options
   */
  const render_success_state = (): React.ReactElement => {
    // safety-check: Ensure advisor data exists
    if (!advisor) {
      return render_error_state();
    }

    return (
      <Card className="w-full hover:shadow-lg transition-shadow duration-200">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-emerald-700">
            <User className="h-5 w-5" />
            Your Advisor
          </CardTitle>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* ============================================ */}
          {/* ADVISOR PROFILE SECTION */}
          {/* Avatar, name, title, and description */}
          {/* ============================================ */}
          <div className="flex items-start gap-4">
            {/* avatar-component: Profile picture with initials fallback */}
            <Avatar className="h-16 w-16 border-2 border-emerald-100">
              {/* profile-image: Show photo if available */}
              <AvatarImage 
                src={advisor.profile_pic_url || undefined} 
                alt={`${advisor.first_name} ${advisor.last_name}`}
              />
              {/* initials-fallback: Show initials if no photo */}
              <AvatarFallback className="bg-emerald-100 text-emerald-700 font-semibold text-lg">
                {get_initials(advisor.first_name, advisor.last_name)}
              </AvatarFallback>
            </Avatar>

            {/* advisor-details: Name and role information */}
            <div className="flex-1">
              {/* advisor-name: Full name display */}
              <h3 className="text-lg font-semibold text-slate-900">
                {advisor.first_name} {advisor.last_name}
              </h3>
              {/* advisor-title: Job title */}
              <p className="text-sm text-slate-600">
                Business Funding Advisor
              </p>
              {/* advisor-tagline: Brief description */}
              <p className="text-xs text-slate-500 mt-1">
                Your dedicated advisor for all funding needs
              </p>
            </div>
          </div>

          {/* ============================================ */}
          {/* CONTACT INFORMATION SECTION */}
          {/* Email and phone with icons */}
          {/* ============================================ */}
          <div className="space-y-3 pt-4 border-t border-slate-100">
            {/* email-row: Email address with mail icon */}
            <div className="flex items-center gap-3">
              {/* email-icon-box: Circular icon container */}
              <div className="flex-shrink-0 w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                <Mail className="h-5 w-5 text-emerald-600" />
              </div>
              {/* email-content: Label and clickable link */}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-600 font-medium">Email</p>
                <a 
                  href={`mailto:${advisor.email}`}
                  className="text-sm text-emerald-600 hover:text-emerald-700 hover:underline truncate block"
                >
                  {advisor.email}
                </a>
              </div>
            </div>

            {/* phone-row: Phone number with phone icon (conditional) */}
            {advisor.phone && (
              <div className="flex items-center gap-3">
                {/* phone-icon-box: Circular icon container */}
                <div className="flex-shrink-0 w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                  <Phone className="h-5 w-5 text-emerald-600" />
                </div>
                {/* phone-content: Label and clickable link */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-600 font-medium">Phone</p>
                  <a 
                    href={`tel:${advisor.phone}`}
                    className="text-sm text-emerald-600 hover:text-emerald-700 hover:underline"
                  >
                    {advisor.phone}
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* ============================================ */}
          {/* ACTION BUTTONS SECTION */}
          {/* Quick contact buttons */}
          {/* ============================================ */}
          <div className="flex gap-2 pt-2">
            {/* email-button: Primary action button */}
            <Button 
              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => window.location.href = `mailto:${advisor.email}`}
            >
              <Mail className="h-4 w-4 mr-2" />
              Send Email
            </Button>
            
            {/* call-button: Secondary action button (conditional) */}
            {advisor.phone && (
              <Button 
                variant="outline"
                className="flex-1 border-emerald-600 text-emerald-600 hover:bg-emerald-50"
                onClick={() => window.location.href = `tel:${advisor.phone}`}
              >
                <Phone className="h-4 w-4 mr-2" />
                Call Now
              </Button>
            )}
          </div>

          {/* ============================================ */}
          {/* HELP TEXT SECTION */}
          {/* Encouragement message */}
          {/* ============================================ */}
          <div className="bg-slate-50 rounded-lg p-3 mt-4">
            {/* help-message: Friendly support text */}
            <p className="text-xs text-slate-600 text-center">
              Have questions? Your advisor is here to help you through every step of the funding process.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  };

  // ============================================
  // MAIN RENDER WITH SWITCH STATEMENT
  // Clean switch-based rendering instead of nested ifs
  // ============================================
  switch (component_state) {
    case ComponentState.LOADING:
      return render_loading_state();
    
    case ComponentState.ERROR:
      return render_error_state();
    
    case ComponentState.SUCCESS:
      return render_success_state();
    
    case ComponentState.NO_DATA:
      return <div></div>;
    
    default:
      // exhaustive-check: TypeScript ensures all enum cases are handled
      // This should never be reached
      console.error("❌ Unknown component state:", component_state);
      return render_error_state();
  }
}