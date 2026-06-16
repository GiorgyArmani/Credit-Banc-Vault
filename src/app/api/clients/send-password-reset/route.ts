// src/app/api/clients/send-password-reset/route.ts
/**
 * ============================================================================
 * API ENDPOINT: POST /api/clients/send-password-reset
 * ============================================================================
 *
 * Triggers a client password-reset link delivery via GHL.
 *
 * Rather than emailing/SMSing a raw temporary password, this writes the vault
 * forgot-password URL onto the client's GHL contact custom field (RESET_PW_LINK).
 * A GHL workflow listens on that field and delivers the link to the client over
 * their preferred channel (email/SMS), so even non-technical clients can set a
 * new password they remember.
 *
 * FLOW:
 * 1. Authenticate the calling advisor
 * 2. Verify owner-or-follower access to the requested client
 * 3. PUT the forgot-password URL onto GHL custom field RESET_PW_LINK
 * 4. Return success
 *
 * ============================================================================
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ghlUpdateContact } from "@/lib/ghl-api";

const FORGOT_PASSWORD_URL = "https://vault.creditbanc.io/auth/forgot-password";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { client_id } = body;

        if (!client_id) {
            return NextResponse.json(
                { success: false, error: "client_id is required" },
                { status: 400 }
            );
        }

        const resetFieldId = process.env.RESET_PW_LINK;
        if (!resetFieldId) {
            return NextResponse.json(
                { success: false, error: "RESET_PW_LINK env var is not configured" },
                { status: 500 }
            );
        }

        // 1. Authenticate advisor
        const supabase = await createServerClient();
        const { data: { user }, error: auth_error } = await supabase.auth.getUser();

        if (auth_error || !user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const supabaseAdmin = createAdminClient();

        // Admins manage every client profile, so they bypass the owner/follower
        // gate below.
        const { data: caller_row } = await supabaseAdmin
            .from("users")
            .select("role")
            .eq("id", user.id)
            .maybeSingle();
        const is_admin = caller_row?.role === "admin";

        // 2. Locate advisor record
        let { data: advisor_data } = await supabaseAdmin
            .from("advisors")
            .select("id")
            .eq("user_id", user.id)
            .maybeSingle();

        if (!advisor_data) {
            const { data: user_record } = await supabaseAdmin
                .from("users")
                .select("email")
                .eq("id", user.id)
                .maybeSingle();

            if (user_record?.email) {
                const { data: advisor_by_email } = await supabaseAdmin
                    .from("advisors")
                    .select("id")
                    .eq("email", user_record.email)
                    .maybeSingle();
                advisor_data = advisor_by_email;
            }
        }

        if (!advisor_data && !is_admin) {
            return NextResponse.json(
                { success: false, error: "Advisor profile not found" },
                { status: 403 }
            );
        }

        // 3. Fetch client + verify owner/follower access
        const { data: client_data, error: client_error } = await supabaseAdmin
            .from("client_data_vault")
            .select("id, client_email, ghl_contact_id, advisor_id")
            .eq("id", client_id)
            .maybeSingle();

        if (client_error || !client_data) {
            return NextResponse.json(
                { success: false, error: "Client not found" },
                { status: 404 }
            );
        }

        let has_access = is_admin || client_data.advisor_id === advisor_data?.id;
        if (!has_access) {
            const { data: follower_row } = await supabaseAdmin
                .from("client_followers")
                .select("id")
                .eq("client_vault_id", client_data.id)
                .eq("advisor_id", advisor_data?.id)
                .maybeSingle();
            has_access = !!follower_row;
        }
        if (!has_access) {
            return NextResponse.json(
                { success: false, error: "You do not have permission to manage this client" },
                { status: 403 }
            );
        }

        if (!client_data.ghl_contact_id) {
            return NextResponse.json(
                {
                    success: false,
                    error: "This client has no linked GHL contact, so the reset link cannot be sent via GHL.",
                },
                { status: 409 }
            );
        }

        // 4. Write the reset URL onto the GHL custom field — this fires the
        // GHL workflow that actually delivers the link to the client.
        // Append a timestamp so back-to-back sends always write a *different*
        // value; some GHL "field changed" triggers only fire on real changes.
        const resetUrlWithCacheBust = `${FORGOT_PASSWORD_URL}?t=${Date.now()}`;
        try {
            await ghlUpdateContact(client_data.ghl_contact_id, {
                customFields: [{ id: resetFieldId, value: resetUrlWithCacheBust }],
            });
        } catch (ghlError: any) {
            console.error("GHL update failed:", ghlError);
            return NextResponse.json(
                {
                    success: false,
                    error: `Failed to update GHL contact: ${ghlError?.message || "unknown error"}`,
                },
                { status: 502 }
            );
        }

        console.log(
            `✅ Sent password-reset link to GHL contact ${client_data.ghl_contact_id} (${client_data.client_email})`
        );

        return NextResponse.json({
            success: true,
            message: `Password reset link sent to ${client_data.client_email}`,
        });
    } catch (error: any) {
        console.error("💥 send-password-reset error:", error);
        return NextResponse.json(
            { success: false, error: error.message || "Internal server error" },
            { status: 500 }
        );
    }
}
