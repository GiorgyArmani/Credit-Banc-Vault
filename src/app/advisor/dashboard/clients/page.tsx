// src/app/advisor/dashboard/clients/page.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Users,
    Search,
    FileText,
    Calendar,
    Mail,
    Phone,
    AlertCircle,
    Loader2,
    ChevronRight,
    CheckCircle2
} from "lucide-react";
import clsx from "clsx";

/**
 * ============================================================================
 * ADVISOR CLIENTS LIST PAGE
 * ============================================================================
 * 
 * This page allows advisors to:
 * 1. View all clients they have created
 * 2. Search and filter clients
 * 3. See client document upload status
 * 4. Navigate to individual client document views
 * 
 * DATABASE FLOW:
 * 1. Get current advisor's ID from users table
 * 2. Query client_data_vault WHERE advisor_id = current_advisor_id
 * 3. For each client, count uploaded documents from user_documents table
 * 
 * ARCHITECTURE:
 * - Uses enum-based state management for clean component state
 * - Implements search functionality with debouncing
 * - Responsive grid layout for client cards
 * - Color-coded badges for document completion status
 * ============================================================================
 */

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * component-state-enum: Enum for different component states
 * Provides cleaner state management than multiple boolean flags
 */
enum ComponentState {
    LOADING = "LOADING",
    ERROR = "ERROR",
    SUCCESS = "SUCCESS",
    NO_CLIENTS = "NO_CLIENTS",
}

/**
 * client-info: Structure for client data from database
 * Combines data from client_data_vault with document counts
 */
interface ClientInfo {
    id: string;                    // client_data_vault.id
    user_id: string;               // Links to auth.users.id
    client_name: string;           // Full name of client
    client_email: string;          // Client's email address
    company_name: string;          // Business name
    capital_requested: number;     // Funding amount requested
    created_at: string;            // When client was created
    document_count: number;        // Number of documents uploaded
    total_required_docs: number;   // Total documents needed (typically 5)
}

export default function AdvisorClientsListPage() {
    // ============================================
    // STATE MANAGEMENT
    // ============================================

    const supabase = createClient();
    const router = useRouter();

    // component-state: Single source of truth for component state
    const [component_state, set_component_state] = useState<ComponentState>(
        ComponentState.LOADING
    );

    // clients-state: Stores all clients created by this advisor
    const [clients, set_clients] = useState<ClientInfo[]>([]);

    // filtered-clients-state: Stores search-filtered clients
    const [filtered_clients, set_filtered_clients] = useState<ClientInfo[]>([]);

    // search-query-state: Current search input value
    const [search_query, set_search_query] = useState<string>("");

    // error-message-state: Stores specific error message
    const [error_message, set_error_message] = useState<string>("");

    // advisor-info-state: Stores current advisor information
    const [advisor_name, set_advisor_name] = useState<string>("");

    // ============================================
    // FETCH CLIENTS DATA ON MOUNT
    // ============================================
    useEffect(() => {
        fetch_advisor_clients();
    }, []);

    // ============================================
    // SEARCH FILTER EFFECT
    // Updates filtered clients whenever search query changes
    // ============================================
    useEffect(() => {
        if (search_query.trim() === "") {
            // No search query - show all clients
            set_filtered_clients(clients);
        } else {
            // Filter clients by name, email, or company name
            const query_lower = search_query.toLowerCase();
            const filtered = clients.filter(client =>
                client.client_name.toLowerCase().includes(query_lower) ||
                client.client_email.toLowerCase().includes(query_lower) ||
                client.company_name.toLowerCase().includes(query_lower)
            );
            set_filtered_clients(filtered);
        }
    }, [search_query, clients]);

    /**
     * fetch-advisor-clients: Main function to retrieve all clients for current advisor
     * 
     * QUERY FLOW:
     * 1. Authenticate and get current user
     * 2. Verify user has advisor role
     * 3. Get advisor profile ID from advisors table (links users → advisors)
     * 4. Get all client_data_vault records where advisor_id = advisor profile ID
     * 5. For each client, count their uploaded documents
     */
    async function fetch_advisor_clients() {
        try {
            set_component_state(ComponentState.LOADING);

            // ============================================
            // STEP 1: AUTHENTICATE AND GET ADVISOR INFO
            // ============================================
            const { data: { user }, error: auth_error } = await supabase.auth.getUser();

            if (auth_error || !user) {
                console.error("❌ Authentication error:", auth_error);
                set_error_message("Authentication failed. Please log in again.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            console.log("✅ User authenticated:", user.id);

            // ============================================
            // STEP 2: VERIFY ADVISOR ROLE
            // Query users table to confirm this user is an advisor
            // ============================================
            const { data: user_data, error: user_error } = await supabase
                .from("users")
                .select("id, first_name, last_name, role, email")
                .eq("id", user.id)
                .maybeSingle();

            if (user_error || !user_data) {
                console.error("❌ Error fetching user data:", user_error);
                set_error_message("Could not verify advisor status.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            // role-check: Ensure user has advisor role
            if (user_data.role !== "advisor") {
                console.error("❌ User is not an advisor");
                set_error_message("Access denied. You must be an advisor to view this page.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            const full_name = `${user_data.first_name} ${user_data.last_name}`;
            set_advisor_name(full_name);
            console.log("✅ User verified as advisor:", full_name);

            // ============================================
            // STEP 3: GET ADVISOR PROFILE ID
            // The advisors table is separate from users table
            // We need to find the advisor record that matches this user
            // ============================================

            // Try Option 1: Link via user_id (if column exists)
            let advisor_query = supabase
                .from("advisors")
                .select("id, first_name, last_name, email")
                .eq("user_id", user.id)
                .maybeSingle();

            let { data: advisor_data, error: advisor_error } = await advisor_query;

            // If user_id column doesn't exist or no match, try Option 2: Link via email
            if (!advisor_data && !advisor_error) {
                console.log("⚠️ No advisor found by user_id, trying email match...");
                const email_query = await supabase
                    .from("advisors")
                    .select("id, first_name, last_name, email")
                    .eq("email", user_data.email)
                    .maybeSingle();

                advisor_data = email_query.data;
                advisor_error = email_query.error;

                // Self-healing: If found by email but not linked, link it now!
                if (advisor_data) {
                    console.log("⚠️ Advisor found by email but not linked. Linking now...");
                    const { error: update_error } = await supabase
                        .from("advisors")
                        .update({ user_id: user.id })
                        .eq("id", advisor_data.id);

                    if (update_error) {
                        console.error("❌ Failed to link advisor profile:", update_error);
                    } else {
                        console.log("✅ Automatically linked advisor profile to user:", user.id);
                    }
                }
            }

            if (advisor_error) {
                console.error("❌ Error fetching advisor profile:", advisor_error);
                set_error_message("Could not load advisor profile. Please contact support.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            if (!advisor_data) {
                console.error("❌ No advisor profile found for this user");
                set_error_message(
                    "No advisor profile found. Please contact support to set up your advisor account."
                );
                set_component_state(ComponentState.ERROR);
                return;
            }

            console.log("✅ Advisor profile found:", advisor_data.id);

            // ============================================
            // STEP 4: FETCH ALL CLIENTS FOR THIS ADVISOR
            // Query client_data_vault where advisor_id = advisor profile ID
            // ============================================
            const { data: clients_data, error: clients_error } = await supabase
                .from("client_data_vault")
                .select(`
          id,
          user_id,
          client_name,
          client_email,
          company_name,
          capital_requested,
          created_at
        `)
                .eq("advisor_id", advisor_data.id)
                .order("created_at", { ascending: false });

            if (clients_error) {
                console.error("❌ Error fetching clients:", clients_error);
                set_error_message("Error loading your clients. Please try again.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            // Handle case where advisor has no clients yet
            if (!clients_data || clients_data.length === 0) {
                console.log("⚠️ No clients found for this advisor");
                set_component_state(ComponentState.NO_CLIENTS);
                return;
            }

            console.log(`✅ Found ${clients_data.length} clients`);

            // ============================================
            // STEP 5: COUNT DOCUMENTS FOR EACH CLIENT
            // For each client, query user_documents to get document count
            // ============================================
            const clients_with_doc_counts = await Promise.all(
                clients_data.map(async (client) => {
                    // Query user_documents table for this client's uploads
                    const { data: docs, error: docs_error } = await supabase
                        .from("user_documents")
                        .select("id")
                        .eq("user_id", client.user_id);

                    if (docs_error) {
                        console.error(`⚠️ Error counting docs for client ${client.id}:`, docs_error);
                        // If error, set count to 0 rather than failing entire query
                        return {
                            ...client,
                            document_count: 0,
                            total_required_docs: 5, // Standard required documents count
                        };
                    }

                    return {
                        ...client,
                        document_count: docs?.length || 0,
                        total_required_docs: 5, // Standard required documents count
                    };
                })
            );

            console.log("✅ Document counts calculated for all clients");

            set_clients(clients_with_doc_counts);
            set_filtered_clients(clients_with_doc_counts);
            set_component_state(ComponentState.SUCCESS);

        } catch (err: any) {
            console.error("❌ Unexpected error:", err);
            set_error_message("An unexpected error occurred. Please try again.");
            set_component_state(ComponentState.ERROR);
        }
    }

    /**
     * navigate-to-client-details: Navigate to individual client's document view
     * Opens the client details page showing all uploaded documents
     */
    function navigate_to_client_details(client_id: string) {
        router.push(`/advisor/dashboard/clients/${client_id}`);
    }

    /**
     * get-completion-badge-color: Returns color class based on document completion
     * Green for complete, yellow for in progress, red for not started
     */
    function get_completion_badge_color(document_count: number, total: number): string {
        const percentage = (document_count / total) * 100;

        if (percentage >= 100) return "bg-emerald-100 text-emerald-800 border-emerald-200";
        if (percentage >= 50) return "bg-yellow-100 text-yellow-800 border-yellow-200";
        return "bg-red-100 text-red-800 border-red-200";
    }

    /**
     * format-date: Formats ISO date string to readable format
     */
    function format_date(iso_string: string): string {
        const date = new Date(iso_string);
        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric"
        });
    }

    /**
     * format-currency: Formats number as USD currency
     */
    function format_currency(amount: number): string {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
    }

    // ============================================
    // RENDER FUNCTIONS FOR DIFFERENT STATES
    // ============================================

    /**
     * render-loading-state: Shows loading spinner and message
     */
    function render_loading_state() {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <Loader2 className="h-12 w-12 text-emerald-600 animate-spin mb-4" />
                <p className="text-gray-600">Loading your clients...</p>
            </div>
        );
    }

    /**
     * render-error-state: Shows error message with retry option
     */
    function render_error_state() {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <div className="bg-red-50 border border-red-200 rounded-xl p-8 max-w-md text-center">
                    <AlertCircle className="h-12 w-12 text-red-600 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        Error Loading Clients
                    </h3>
                    <p className="text-gray-600 mb-4">{error_message}</p>
                    <Button
                        onClick={fetch_advisor_clients}
                        variant="outline"
                    >
                        Try Again
                    </Button>
                </div>
            </div>
        );
    }

    /**
     * render-no-clients-state: Shows empty state when advisor has no clients
     */
    function render_no_clients_state() {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 max-w-md text-center">
                    <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        No Clients Yet
                    </h3>
                    <p className="text-gray-600 mb-4">
                        You haven't created any client accounts yet. Start by creating your first client.
                    </p>
                    <Button
                        onClick={() => router.push("/advisor/dashboard/clients/new")}
                        className="bg-emerald-600 hover:bg-emerald-700"
                    >
                        <FileText className="h-4 w-4 mr-2" />
                        Create First Client
                    </Button>
                </div>
            </div>
        );
    }

    /**
     * render-client-card: Renders individual client card with information
     */
    function render_client_card(client: ClientInfo) {
        const completion_percentage = Math.round(
            (client.document_count / client.total_required_docs) * 100
        );
        const badge_color = get_completion_badge_color(
            client.document_count,
            client.total_required_docs
        );

        return (
            <Card
                key={client.id}
                className="hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => navigate_to_client_details(client.id)}
            >
                <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                        <div className="flex-1">
                            <CardTitle className="text-lg font-semibold text-gray-900">
                                {client.client_name}
                            </CardTitle>
                            <CardDescription className="mt-1">
                                {client.company_name}
                            </CardDescription>
                        </div>
                        <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0 mt-1" />
                    </div>
                </CardHeader>

                <CardContent className="space-y-4">
                    {/* Contact Information */}
                    <div className="space-y-2">
                        <div className="flex items-center text-sm text-gray-600">
                            <Mail className="h-4 w-4 mr-2 text-gray-400" />
                            <span className="truncate">{client.client_email}</span>
                        </div>
                        <div className="flex items-center text-sm text-gray-600">
                            <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                            <span>Created {format_date(client.created_at)}</span>
                        </div>
                    </div>

                    {/* Funding Request */}
                    <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">Capital Requested</p>
                        <p className="text-lg font-semibold text-gray-900">
                            {format_currency(client.capital_requested)}
                        </p>
                    </div>

                    {/* Document Upload Status */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-700">
                                Document Status
                            </span>
                            <Badge
                                variant="outline"
                                className={clsx("text-xs font-semibold border", badge_color)}
                            >
                                {client.document_count}/{client.total_required_docs}
                            </Badge>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                                className={clsx(
                                    "h-2 rounded-full transition-all",
                                    completion_percentage >= 100 ? "bg-emerald-600" :
                                        completion_percentage >= 50 ? "bg-yellow-500" :
                                            "bg-red-500"
                                )}
                                style={{ width: `${Math.min(completion_percentage, 100)}%` }}
                            />
                        </div>

                        <p className="text-xs text-gray-500 mt-1">
                            {completion_percentage}% complete
                        </p>
                    </div>

                    {/* View Details Button */}
                    <Button
                        variant="outline"
                        className="w-full mt-2"
                        onClick={(e) => {
                            e.stopPropagation();
                            navigate_to_client_details(client.id);
                        }}
                    >
                        View Documents
                    </Button>
                </CardContent>
            </Card>
        );
    }

    /**
     * render-success-state: Shows client list with search functionality
     */
    function render_success_state() {
        return (
            <div className="space-y-6">
                {/* Search Bar */}
                <Card>
                    <CardContent className="pt-6">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input
                                type="text"
                                placeholder="Search by client name, email, or company..."
                                value={search_query}
                                onChange={(e) => set_search_query(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Results Summary */}
                <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                        Showing {filtered_clients.length} of {clients.length} clients
                    </p>
                    <Button
                        onClick={() => router.push("/advisor/dashboard/clients/new")}
                        className="bg-emerald-600 hover:bg-emerald-700"
                    >
                        <FileText className="h-4 w-4 mr-2" />
                        New Client
                    </Button>
                </div>

                {/* Client Grid */}
                {filtered_clients.length === 0 ? (
                    <div className="text-center py-12">
                        <Search className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-600">
                            No clients match your search criteria
                        </p>
                    </div>
                ) : (
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                        {filtered_clients.map(client => render_client_card(client))}
                    </div>
                )}
            </div>
        );
    }

    // ============================================
    // MAIN RENDER WITH STATE SWITCH
    // ============================================
    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-gray-900">
                    Your Clients
                </h1>
                <p className="text-muted-foreground mt-2">
                    {advisor_name && `Welcome back, ${advisor_name}! `}
                    Manage and track your clients' document submissions
                </p>
            </div>

            {/* State-Based Rendering */}
            {(() => {
                switch (component_state) {
                    case ComponentState.LOADING:
                        return render_loading_state();
                    case ComponentState.ERROR:
                        return render_error_state();
                    case ComponentState.NO_CLIENTS:
                        return render_no_clients_state();
                    case ComponentState.SUCCESS:
                        return render_success_state();
                    default:
                        return null;
                }
            })()}
        </div>
    );
}