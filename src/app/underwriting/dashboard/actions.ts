// src/app/underwriting/dashboard/actions.ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { send_advisor_document_notification, send_loan_funded_notification, send_client_funded_email } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";
import { ghlUpdateContact, ghlAddTags } from "@/lib/ghl-api";
import { updateLoanStatus } from "@/app/actions/pipeline";
// No startNewFundingRound import on purpose: funding never opens a round.
// Opening one is a deliberate act through the Funding Rounds card.
import { getActiveDeal, isDealFunded } from "@/lib/funding-deals";
import { computeRenewalDates } from "@/lib/renewals";
import { revalidatePath } from "next/cache";
import { markLabelAsManual } from "@/lib/group-assignment";
import { canRecordFunded } from "@/lib/auth/roles";

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

/**
 * Resolve the caller's role with the SERVICE ROLE, so RLS can't mask it.
 *
 * A server action is reachable by POSTing its action id to any route, so an
 * `await supabase.auth.getUser()` null-check is authentication only — it proves
 * somebody is logged in, not that they are allowed. Anything below that writes
 * with createAdminClient() needs this second check too.
 */
async function resolveActorRole(): Promise<{ userId: string; role: string } | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: actorRow } = await createAdminClient()
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

    return { userId: user.id, role: actorRow?.role ?? "unknown" };
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

    try {
        // AUTHORIZATION, not just authentication. This action writes
        // funding_deals.funded_at with the service role for a caller-supplied
        // clientId, flips a lender assignment to funded, tags the client's GHL
        // contact "Loan Funded" and emails their advisor. `funded_at` is also
        // the row the affiliate payout path treats as proof that money moved
        // (see createAffiliatePayoutForFundedVault), so an unauthorized caller
        // reaching here could forge the guardrail standing behind a $500 gift
        // card. Same gate as the pipeline's funded transition, by the same
        // shared list — see [[affiliate_program]].
        const actor = await resolveActorRole();
        if (!actor) throw new Error("Unauthorized");
        if (!canRecordFunded(actor.role)) {
            console.warn(
                `[fundLoanAction] BLOCKED funding of ${clientId} by ${actor.role} ${actor.userId}`
            );
            return { success: false, error: "Forbidden" };
        }

        // 1. Fetch client GHL ID
        const { data: client, error: clientError } = await supabaseAdmin
            .from("client_data_vault")
            .select(`
                ghl_contact_id,
                client_name,
                client_email,
                advisors (
                    first_name,
                    last_name,
                    email,
                    phone,
                    profile_pic_url
                )
            `)
            .eq("id", clientId)
            .single();

        if (clientError || !client || !client.ghl_contact_id) {
            console.error("fundLoanAction Error: Client or GHL Contact ID not found", clientError);
            return { success: false, error: "Client GHL ID not found" };
        }

        console.log("fundLoanAction: Client found. GHL Contact ID:", client.ghl_contact_id);

        // 1.5 GUARD — refuse to fund a round that is already funded.
        //
        // This runs BEFORE any side effect. Everything below (the GHL "Loan
        // Funded" tag, the custom fields, the internal note, the advisor email)
        // is irreversible from here, so the check cannot live down at the
        // funding_deals write where the problem is actually detected — a late
        // bail would leave the client tagged and the advisor emailed about a
        // funding that was never recorded.
        //
        // Opening the next round is deliberately a MANUAL act: a second funding
        // on an already-funded round means the workflow was skipped, and the
        // person doing it should decide that consciously rather than have the
        // system quietly invent a round behind them.
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

        let activeDeal = null as Awaited<ReturnType<typeof getActiveDeal>>;
        if (fundedBusinessProfileId) {
            activeDeal = await getActiveDeal(supabaseAdmin, fundedBusinessProfileId);
            if (isDealFunded(activeDeal)) {
                console.warn(
                    `fundLoanAction BLOCKED on ${clientId}: round ${(activeDeal!.display_order ?? 0) + 1} is already funded`
                );
                return {
                    success: false,
                    error:
                        `This business's latest funding round is already recorded as funded` +
                        `${activeDeal!.lender_funded ? ` (${activeDeal!.lender_funded})` : ""}. ` +
                        `Start a new funding round from the Funding Rounds card first, then record this funding against it — ` +
                        `that keeps the previous round's amount, lender and date intact.`,
                };
            }
        }

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
            .eq("id", actor.userId)
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
            author_id: actor.userId,
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

        // 5.5 Send the "Approved. Funded. Done." email to the CLIENT.
        //
        //     Separate try/catch from the advisor send above on purpose: these
        //     are two different recipients and one failing must not swallow the
        //     other. Both are best-effort — the funding is the thing being
        //     recorded here, and no mail failure may undo it.
        try {
            const advisor = client.advisors as any;
            if (client.client_email) {
                await send_client_funded_email({
                    client_name: client.client_name,
                    client_email: client.client_email,
                    advisor_name: advisor ? `${advisor.first_name} ${advisor.last_name || ""}`.trim() : null,
                    advisor_phone: advisor?.phone ?? null,
                    advisor_photo_url: advisor?.profile_pic_url ?? null,
                });
                console.log("fundLoanAction: Funded email sent to client.");
            } else {
                console.warn("fundLoanAction Warning: No client email on the vault; funded email skipped.");
            }
        } catch (clientEmailError) {
            console.error("fundLoanAction Error: Failed to send client funded email:", clientEmailError);
            // Non-fatal
        }

        // 6. Persist the funded figures onto the active business's funding_deal.
        //    This is the in-vault source of truth (powers the admin funded-$ KPI
        //    and renewal tracking). GHL above is the signaling layer; this is the
        //    record. Non-fatal — a missing deal row must not block the tag/email.
        //
        //    The round was resolved and validated in step 1.5, before anything
        //    irreversible ran. This dialog is the ONLY route to a `funded`
        //    pipeline status, and updateLoanStatus refuses `funded` without a
        //    funded funding_deals row.
        let fundedDealId: string | null = null;
        if (fundedBusinessProfileId) {
            try {
                const fundedAmountNum = Number(String(data.totalAmountFunded).replace(/[^0-9.]/g, ""));
                // One instant for both the funded stamp and the renewal schedule
                // derived from it, so they can never disagree by a few ms.
                const fundedAtIso = new Date().toISOString();
                const renewal = computeRenewalDates(fundedAtIso);
                const fundedFields = {
                    funded_amount: Number.isFinite(fundedAmountNum) ? fundedAmountNum : null,
                    lender_funded: data.lenderFunded || null,
                    funded_term: data.termOfFundedLoan || null,
                    funded_at: fundedAtIso,
                    // Drives /api/cron/client-check-ins. Populated here so the
                    // schedule is a fact of the funding, not something a sweep
                    // has to infer — though the cron can derive it for rounds
                    // funded before this existed.
                    renewal_eligibility_date: renewal?.eligibilityDate ?? null,
                    renewal_reminder_at: renewal?.reminderAt ?? null,
                    sales_rep_funded: data.salesRepFunded || null,
                    date_of_submission: data.dateOfSubmission || null,
                    file_synopsis: data.fileSinopsis || null,
                    use_of_proceeds: data.useOfProceeds || null,
                    slack_channel: data.slackChannel || null,
                };

                // An already-funded round was rejected up front (step 1.5), so
                // the only two cases left are "fund the open round" and "no deal
                // row exists yet". Nothing here ever creates a round implicitly.
                if (activeDeal) {
                    await supabaseAdmin.from("funding_deals").update(fundedFields).eq("id", activeDeal.id);
                    fundedDealId = activeDeal.id;
                } else {
                    // No deal row yet — common for primary businesses whose
                    // requested amount still lives on client_data_vault. Create
                    // one so the funded figures persist and the admin funded-$
                    // KPI reads the real funded amount instead of the requested.
                    const { data: created, error: insertErr } = await supabaseAdmin
                        .from("funding_deals")
                        .insert({ business_profile_id: fundedBusinessProfileId, display_order: 0, ...fundedFields })
                        .select("id")
                        .single();
                    if (insertErr) {
                        console.error("fundLoanAction Error: Failed to create funding_deal:", insertErr);
                    } else {
                        fundedDealId = created?.id ?? null;
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

        // 7.5 Announce the funding in the deal's Slack channel. Every other
        //     lender-lifecycle event (submitted / approved / declined) already
        //     posts there; funding — the outcome the channel exists for — did
        //     not. Best-effort and never throws: the funding is already
        //     recorded by this point and must not be undone by a Slack failure.
        try {
            const { notifyDealFundedToSlack } = await import("@/lib/notifications/lender-pipeline");
            await notifyDealFundedToSlack(clientId, {
                lender_name: data.lenderFunded,
                amount_funded: data.totalAmountFunded,
                term: data.termOfFundedLoan,
                amount_requested: data.amountRequested ?? null,
                sales_rep: data.salesRepFunded,
            });
        } catch (slackError) {
            console.error("fundLoanAction Error: Slack funded post failed (non-fatal):", slackError);
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
                `Funded by ${data.lenderFunded || "lender"} — ${data.totalAmountFunded}`,
                fundedDealId
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
 * requireUnderwritingOrAdmin
 *
 * File actions on this page are reached from both /underwriting/... and the
 * admin routes that render the same component, so both roles must pass. Throws
 * on anyone else — every caller here runs on the service role afterwards, so
 * this check is the only thing standing between a client and another client's
 * documents.
 */
async function requireUnderwritingOrAdmin() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { data: userData } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .single();

    if (userData?.role !== "underwriting" && userData?.role !== "admin") {
        throw new Error("Access denied: Underwriting or admin only");
    }
    return { user, role: userData.role as "underwriting" | "admin" };
}

/**
 * renameClientFile
 *
 * Allows an underwriter to update the display name (custom_label) of a file.
 */
export async function renameClientFile(documentId: string, newLabel: string) {
    try {
        await requireUnderwritingOrAdmin();

        const supabaseAdmin = createAdminClient();
        const { error } = await supabaseAdmin
            .from("user_documents")
            .update({ custom_label: newLabel })
            .eq("id", documentId);

        if (error) throw error;

        // Mark the name as hand-typed so filing this document into a group
        // never rebuilds over it. See markLabelAsManual.
        await markLabelAsManual(supabaseAdmin, documentId);

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

/**
 * deleteClientFile
 *
 * Removes a client document (storage object + row) from the UW/admin client
 * detail page. Underwriting handles the file end-to-end in practice — bad scans,
 * wrong-business uploads and superseded statements have to be cleared without
 * routing through the advisor — so this mirrors the advisor's deleteClientFile
 * rather than being a lesser version of it.
 *
 * The document is verified to belong to the client whose page issued the call,
 * so a document id from another vault can't be passed in.
 */
export async function deleteClientFile(clientId: string, documentId: string) {
    try {
        await requireUnderwritingOrAdmin();

        const supabaseAdmin = createAdminClient();

        const { data: client, error: clientError } = await supabaseAdmin
            .from("client_data_vault")
            .select("id, user_id, ghl_contact_id")
            .eq("id", clientId)
            .single();

        if (clientError || !client) throw new Error("Client not found");

        const { data: doc, error: docError } = await supabaseAdmin
            .from("user_documents")
            .select("id, user_id, storage_path")
            .eq("id", documentId)
            .single();

        if (docError || !doc) throw new Error("Document not found");
        if (doc.user_id !== client.user_id) {
            throw new Error("Document does not belong to this client");
        }

        // Storage first; a failure here is logged but not fatal — an orphaned
        // object is better than a row the UI still shows and can't remove.
        const { error: storageError } = await supabaseAdmin.storage
            .from("user-documents")
            .remove([doc.storage_path]);
        if (storageError) {
            console.error("Storage deletion error (UW):", storageError);
        }

        const { error: dbError } = await supabaseAdmin
            .from("user_documents")
            .delete()
            .eq("id", documentId);

        if (dbError) throw new Error(`Failed to delete document record: ${dbError.message}`);

        // The doc is outstanding again — keep the GHL chase list honest.
        if (client.ghl_contact_id && process.env.GHL_TOKEN) {
            const { syncOutstandingDocuments } = await import("@/lib/outstanding-documents");
            await syncOutstandingDocuments(client.user_id, client.ghl_contact_id, process.env.GHL_TOKEN);
        }

        revalidateClientSurfaces(clientId);
        revalidatePath(`/advisor/dashboard/clients/${clientId}`);

        return { success: true };
    } catch (error: any) {
        console.error("Exception in deleteClientFile (UW):", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}
