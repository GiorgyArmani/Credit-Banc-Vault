// src/app/underwriting/dashboard/actions.ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { send_advisor_document_notification, send_loan_funded_notification } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";
import { ghlUpdateContact, ghlAddTags } from "@/lib/ghl-api";
import { updateLoanStatus } from "@/app/actions/pipeline";
import { revalidatePath } from "next/cache";

/**
 * Centralizes the cache-invalidation surface every mutation in this file
 * needs to hit so the UW dashboard and the touched client's detail page
 * refresh after the action returns. Without these calls the user sees
 * stale data until manual refresh.
 */
function revalidateClientSurfaces(clientId: string) {
    revalidatePath("/underwriting/dashboard");
    revalidatePath(`/underwriting/dashboard/clients/${clientId}`);
    revalidatePath("/admin/dashboard");
    revalidatePath(`/admin/clients/${clientId}`);
}

export async function notifyAdvisor(clientId: string, missingDocs: string[], additionalDocs: string[], customNote?: string) {
    const requestedDocs = [...missingDocs, ...additionalDocs];
    const supabaseAdmin = createAdminClient();
    const supabase = await createClient();

    try {
        // Get the current user (Underwriter)
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser) throw new Error("Unauthorized");

        // 1. Fetch client and advisor info
        const { data: client, error: clientError } = await supabaseAdmin
            .from("client_data_vault")
            .select(`
                user_id,
                client_name,
                advisor_id,
                advisors (
                    first_name,
                    last_name,
                    email,
                    user_id
                )
            `)
            .eq("id", clientId)
            .single();

        if (clientError || !client) {
            return { success: false, error: "Client or advisor not found" };
        }

        const advisor = client.advisors as any;
        if (!advisor || !advisor.email || !advisor.user_id) {
            return { success: false, error: "Advisor contact info missing" };
        }

        // Normalize the advisor-facing note (may be empty)
        const advisorNote = customNote?.trim() || "";

        // 2. Insert In-App Notification for the Advisor
        const docCount = requestedDocs.length;
        const notificationTitle = `Action Required: Documents for ${client.client_name}`;
        const notificationMessage = `Underwriting requested ${docCount} ${docCount === 1 ? 'document' : 'documents'}${advisorNote ? ` — ${advisorNote}` : '.'}`;

        await supabaseAdmin.from("in_app_notifications").insert({
            user_id: advisor.user_id,
            client_id: clientId,
            title: notificationTitle,
            message: notificationMessage,
            is_read: false
        });

        // 3. Insert a clean internal note for the audit trail
        {
            // Fetch underwriter profile to get name
            const { data: profile } = await supabaseAdmin
                .from("users")
                .select("first_name, last_name")
                .eq("id", currentUser.id)
                .single();

            const authorName = profile ? `${profile.first_name} ${profile.last_name || ''}`.trim() : "Underwriter";

            const sections: string[] = [];
            if (missingDocs.length > 0) {
                sections.push(`Missing required items:\n${missingDocs.map(doc => `• ${doc}`).join("\n")}`);
            }
            if (additionalDocs.length > 0) {
                sections.push(`Additional documents requested:\n${additionalDocs.map(doc => `• ${doc}`).join("\n")}`);
            }
            if (advisorNote) {
                sections.push(advisorNote);
            }
            const noteContent = sections.join("\n\n").trim();

            await supabaseAdmin.from("client_internal_notes").insert({
                client_id: clientId,
                author_id: currentUser.id,
                author_role: "underwriting",
                author_name: authorName,
                content: noteContent
            });
        }

        // 4. Update submission status to 'documents_requested'
        const { error: statusError } = await supabaseAdmin
            .from("submissions")
            .update({ status: 'documents_requested' })
            .eq("user_id", client.user_id);

        if (statusError) {
            console.error("Error updating submission status:", statusError);
            // Non-fatal, but good to know
        }

        // 5. Send notification email (CC followers)
        const { getFollowerEmailsForClient } = await import("@/lib/followers");
        const follower_emails = await getFollowerEmailsForClient(supabaseAdmin, clientId);

        await send_advisor_document_notification({
            advisor_name: `${advisor.first_name} ${advisor.last_name}`,
            advisor_email: advisor.email,
            advisor_cc_emails: follower_emails,
            client_name: client.client_name,
            missing_documents: missingDocs,
            additional_documents: additionalDocs,
            custom_message: advisorNote || undefined,
            login_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io'}/auth/login`
        });

        revalidateClientSurfaces(clientId);
        return { success: true };
    } catch (error: any) {
        console.error("notifyAdvisor error:", error);
        return { success: false, error: error.message };
    }
}

export async function fundLoanAction(clientId: string, data: {
    fileSinopsis: string;
    termOfFundedLoan: string;
    totalAmountFunded: string;
    useOfProceeds: string;
    slackChannel: string;
    salesRepFunded: string;
    lenderFunded: string;
    dateOfSubmission: string;
    fundingDate: string;
    /** Active business whose funding_deal receives the funded figures. */
    businessProfileId?: string | null;
    /** What was originally asked for — recorded alongside the funded amount. */
    amountRequested?: string | number | null;
    /** The lender-selection row chosen as the funder; flipped to status='funded'. */
    fundedAssignmentId?: string | null;
}) {
    const supabaseAdmin = createAdminClient();
    const supabase = await createClient();

    try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser) throw new Error("Unauthorized");

        // 1. Fetch client GHL ID
        const { data: client, error: clientError } = await supabaseAdmin
            .from("client_data_vault")
            .select(`
                ghl_contact_id, 
                client_name,
                advisors (
                    first_name,
                    last_name,
                    email
                )
            `)
            .eq("id", clientId)
            .single();

        if (clientError || !client || !client.ghl_contact_id) {
            console.error("fundLoanAction Error: Client or GHL Contact ID not found", clientError);
            return { success: false, error: "Client GHL ID not found" };
        }

        console.log("fundLoanAction: Client found. GHL Contact ID:", client.ghl_contact_id);

        // 2. Prepare GHL payload
        const customFields = [
            { id: process.env.FILE_SINOPSIS, value: data.fileSinopsis },
            { id: process.env.TERM_OF_FUNDED_LOAN, value: data.termOfFundedLoan },
            { id: process.env.TOTAL_AMOUNT_FUNDED, value: data.totalAmountFunded },
            { id: process.env.USE_OF_PROCEEDS, value: data.useOfProceeds },
            { id: process.env.SLACK_CHANNEL, value: data.slackChannel },
            { id: process.env.SALES_REP_FUNDED, value: data.salesRepFunded },
            // DATE_FUNDED (the "date they were funded" GHL field) is no longer
            // collected: at the moment UW marks a deal funded, only the funding
            // date is known — the money can land in the client's account days
            // later. FUNDING_DATE below is the one UW can actually attest to.
            { id: process.env.LENDER_FUNDED, value: data.lenderFunded },
            { id: process.env.DATE_OF_SUBMISSION, value: data.dateOfSubmission },
            { id: process.env.FUNDING_DATE, value: data.fundingDate },
        ].filter((f): f is { id: string; value: string } => !!f.id);

        console.log("fundLoanAction: GHL valid custom fields mapped:", customFields);

        // 3. Update GHL Contact (Tag + Custom Fields)
        try {
            await ghlAddTags(client.ghl_contact_id, ["Loan Funded"]);
            console.log("fundLoanAction: Added 'Loan Funded' tag successfully.");
        } catch (tagError) {
            console.error("fundLoanAction Error: Failed to add tags:", tagError);
        }

        try {
            await ghlUpdateContact(client.ghl_contact_id, { customFields });
            console.log("fundLoanAction: Updated custom fields successfully.");
        } catch (updateError) {
            console.error("fundLoanAction Error: Failed to update custom fields:", updateError);
            throw new Error(`Failed to update GHL contact: ${(updateError as any).message}`);
        }

        // 4. Record internal note
        const { data: profile } = await supabaseAdmin
            .from("users")
            .select("first_name, last_name")
            .eq("id", currentUser.id)
            .single();

        const authorName = profile ? `${profile.first_name} ${profile.last_name || ''}`.trim() : "Underwriter";
        const requestedLine = (data.amountRequested ?? '') !== '' ? `- Requested: ${data.amountRequested}\n` : '';
        const noteContent = `LOAN FUNDED DETAILS:\n` +
            requestedLine +
            `- Funded: ${data.totalAmountFunded}\n` +
            `- Lender: ${data.lenderFunded}\n` +
            `- Term: ${data.termOfFundedLoan}\n` +
            `- Date: ${data.fundingDate}\n` +
            `- Sales Rep: ${data.salesRepFunded}`;

        await supabaseAdmin.from("client_internal_notes").insert({
            client_id: clientId,
            author_id: currentUser.id,
            author_role: "underwriting",
            author_name: authorName,
            content: noteContent
        });

        // 5. Send Email to Advisor (CC followers)
        try {
            const advisor = client.advisors as any;
            if (advisor && advisor.email) {
                const { getFollowerEmailsForClient } = await import("@/lib/followers");
                const follower_emails = await getFollowerEmailsForClient(supabaseAdmin, clientId);

                await send_loan_funded_notification({
                    advisor_name: `${advisor.first_name} ${advisor.last_name}`,
                    advisor_email: advisor.email,
                    advisor_cc_emails: follower_emails,
                    client_name: client.client_name,
                    total_amount: data.totalAmountFunded,
                    lender: data.lenderFunded,
                    funding_date: data.fundingDate,
                    login_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io'}/auth/login`
                });
                console.log("fundLoanAction: Email notification sent to advisor.");
            } else {
                console.warn("fundLoanAction Warning: No advisor found to send email to.");
            }
        } catch (emailError) {
            console.error("fundLoanAction Error: Failed to send email:", emailError);
            // Non-fatal, let it succeed
        }

        // 6. Persist the funded figures onto the active business's funding_deal.
        //    This is the in-vault source of truth (powers the admin funded-$ KPI
        //    and renewal tracking). GHL above is the signaling layer; this is the
        //    record. Non-fatal — a missing deal row must not block the tag/email.
        //
        //    This dialog is now the ONLY route to a `funded` pipeline status, and
        //    updateLoanStatus refuses `funded` without a funded funding_deals row.
        //    So when the caller didn't supply a business (a client whose vault has
        //    no active business selected), resolve the primary one here rather
        //    than skipping the write and stranding the transition.
        let fundedBusinessProfileId = data.businessProfileId ?? null;
        if (!fundedBusinessProfileId) {
            const { data: primaryBusiness } = await supabaseAdmin
                .from("business_profiles")
                .select("id")
                .eq("client_vault_id", clientId)
                .order("created_at", { ascending: true })
                .limit(1)
                .maybeSingle();
            fundedBusinessProfileId = primaryBusiness?.id ?? null;
            if (fundedBusinessProfileId) {
                console.log(`fundLoanAction: resolved primary business ${fundedBusinessProfileId} for ${clientId}`);
            }
        }

        if (fundedBusinessProfileId) {
            try {
                const { data: deal } = await supabaseAdmin
                    .from("funding_deals")
                    .select("id")
                    .eq("business_profile_id", fundedBusinessProfileId)
                    .order("display_order", { ascending: true })
                    .limit(1)
                    .maybeSingle();

                const fundedAmountNum = Number(String(data.totalAmountFunded).replace(/[^0-9.]/g, ""));
                const fundedFields = {
                    funded_amount: Number.isFinite(fundedAmountNum) ? fundedAmountNum : null,
                    lender_funded: data.lenderFunded || null,
                    funded_term: data.termOfFundedLoan || null,
                    funded_at: new Date().toISOString(),
                    sales_rep_funded: data.salesRepFunded || null,
                    date_of_submission: data.dateOfSubmission || null,
                    file_synopsis: data.fileSinopsis || null,
                    use_of_proceeds: data.useOfProceeds || null,
                    slack_channel: data.slackChannel || null,
                };

                if (deal?.id) {
                    await supabaseAdmin.from("funding_deals").update(fundedFields).eq("id", deal.id);
                } else {
                    // No deal row yet — common for primary businesses whose
                    // requested amount still lives on client_data_vault. Create
                    // one so the funded figures persist and the admin funded-$
                    // KPI reads the real funded amount instead of the requested.
                    const { error: insertErr } = await supabaseAdmin
                        .from("funding_deals")
                        .insert({ business_profile_id: fundedBusinessProfileId, ...fundedFields });
                    if (insertErr) {
                        console.error("fundLoanAction Error: Failed to create funding_deal:", insertErr);
                    }
                }
            } catch (dealError) {
                console.error("fundLoanAction Error: Failed to persist funding_deal:", dealError);
                // Non-fatal
            }
        }

        // 7. Flip the chosen lender-selection row to 'funded' so the pipeline UI
        //    lights up the Funded badge and the loop closes back to lender match.
        if (data.fundedAssignmentId) {
            try {
                await supabaseAdmin
                    .from("client_lender_assignments")
                    .update({ status: "funded", updated_at: new Date().toISOString() })
                    .eq("id", data.fundedAssignmentId)
                    .eq("client_id", clientId);
            } catch (assignError) {
                console.error("fundLoanAction Error: Failed to mark assignment funded:", assignError);
                // Non-fatal
            }
        }

        // 8. Record the pipeline transition. Reuses updateLoanStatus, which writes
        //    loan_status_history (drives the admin funded-$ KPI) and fires the
        //    advisor "Loan Funded 🎉" in-app notification.
        //
        //    updateLoanStatus now REQUIRES the funded funding_deals row written in
        //    step 6, so a failure there cascades into the status being refused.
        //    That must not report as a clean success: the deal would look funded
        //    in GHL and email while the pipeline still says otherwise. Surface it
        //    so UW knows to retry rather than assuming it landed.
        let statusWarning: string | null = null;
        try {
            const statusRes = await updateLoanStatus(
                clientId,
                "funded",
                `Funded by ${data.lenderFunded || "lender"} — ${data.totalAmountFunded}`
            );
            if (!statusRes.success) {
                statusWarning = statusRes.error || "Pipeline status was not updated.";
                console.error("fundLoanAction: funded transition refused:", statusWarning);
            }
        } catch (statusError) {
            statusWarning = statusError instanceof Error ? statusError.message : String(statusError);
            console.error("fundLoanAction Error: Failed to record funded transition:", statusError);
        }

        revalidateClientSurfaces(clientId);
        if (statusWarning) {
            return {
                success: true as const,
                warning: `The funding details were saved, but the pipeline status did not move to Funded: ${statusWarning}`,
            };
        }
        return { success: true as const };
    } catch (error: any) {
        console.error("fundLoanAction error:", error);
        return { success: false, error: error.message };
    }
}

export async function markDocumentAsViewed(documentId: string) {
    const supabase = createAdminClient();
    const { error } = await supabase
        .from("user_documents")
        .update({ viewed_at: new Date().toISOString() })
        .eq("id", documentId)
        .is("viewed_at", null); // Only update if not already viewed

    if (error) {
        console.error("markDocumentAsViewed error:", error);
        return { success: false, error: error.message };
    }

    return { success: true };
}

/**
 * renameClientFile
 * 
 * Allows an underwriter to update the display name (custom_label) of a file.
 */
export async function renameClientFile(documentId: string, newLabel: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        // Verify user is an underwriter
        const { data: userData } = await supabase
            .from("users")
            .select("role")
            .eq("id", user.id)
            .single();

        if (userData?.role !== "underwriting") {
            throw new Error("Access denied: Underwriters only");
        }

        const supabaseAdmin = createAdminClient();
        const { error } = await supabaseAdmin
            .from("user_documents")
            .update({ custom_label: newLabel })
            .eq("id", documentId);

        if (error) throw error;

        // Find the client to revalidate. The rename only updates the file,
        // so we lookup the user_id → client_vault_id for the cache touch.
        const { data: doc } = await supabaseAdmin
            .from("user_documents")
            .select("user_id")
            .eq("id", documentId)
            .maybeSingle();
        if (doc?.user_id) {
            const { data: vault } = await supabaseAdmin
                .from("client_data_vault")
                .select("id")
                .eq("user_id", doc.user_id)
                .maybeSingle();
            if (vault?.id) revalidateClientSurfaces(vault.id);
        }

        return { success: true };
    } catch (error: any) {
        console.error("Exception in renameClientFile (UW):", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}
