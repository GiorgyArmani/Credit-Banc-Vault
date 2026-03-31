// src/app/underwriting/dashboard/actions.ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { send_advisor_document_notification, send_loan_funded_notification } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";
import { ghlUpdateContact, ghlAddTags } from "@/lib/ghl-api";

export async function notifyAdvisor(clientId: string, requestedDocs: string[], customNote?: string) {
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

        // 2. Insert In-App Notification for the Advisor
        const notificationTitle = `Action Required: Documents for ${client.client_name}`;
        const notificationMessage = `Underwriting has requested missing or additional documents. ${customNote ? 'Note attached.' : ''}`;

        await supabaseAdmin.from("in_app_notifications").insert({
            user_id: advisor.user_id,
            client_id: clientId,
            title: notificationTitle,
            message: notificationMessage,
            is_read: false
        });

        // 3. Insert Internal Note if provided
        if (customNote) {
            // Fetch underwriter profile to get name
            const { data: profile } = await supabaseAdmin
                .from("users")
                .select("first_name, last_name")
                .eq("id", currentUser.id)
                .single();

            const authorName = profile ? `${profile.first_name} ${profile.last_name || ''}`.trim() : "Underwriter";

            await supabaseAdmin.from("client_internal_notes").insert({
                client_id: clientId,
                author_id: currentUser.id,
                author_role: "underwriting",
                author_name: authorName,
                content: customNote
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

        // 5. Send notification email
        await send_advisor_document_notification({
            advisor_name: `${advisor.first_name} ${advisor.last_name}`,
            advisor_email: advisor.email,
            client_name: client.client_name,
            requested_documents: requestedDocs,
            login_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io'}/auth/login`
        });

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
    dateFunded: string;
    lenderFunded: string;
    dateOfSubmission: string;
    fundingDate: string;
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
            { id: process.env.DATE_FUNDED, value: data.dateFunded },
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
        const noteContent = `LOAN FUNDED DETAILS:\n` +
            `- Amount: ${data.totalAmountFunded}\n` +
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

        // 5. Send Email to Advisor
        try {
            const advisor = client.advisors as any;
            if (advisor && advisor.email) {
                await send_loan_funded_notification({
                    advisor_name: `${advisor.first_name} ${advisor.last_name}`,
                    advisor_email: advisor.email,
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

        return { success: true };
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
