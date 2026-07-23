"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { ghlAddTags, ghlUpdateContact } from "@/lib/ghl-api";
import { formatPhoneUS, isValidUsPhone, toE164 } from "@/lib/phone";
import { syncUnifiedClientData } from "@/lib/user-management";
import { updateLoanStatus } from "@/app/actions/pipeline";
import { ghlSyncDocument } from "@/lib/ghl-document-sync";
import { isClientScopedDoc } from "@/lib/document-scope";
import { resolveCatchAllAdvisor } from "@/lib/catch-all-advisor";
import { send_file_reassignment_notification } from "@/lib/email";

/**
 * Owner OR follower check. Admin flow isn't covered here (advisor-persona actions).
 * Returns true if advisorId owns or follows the given client.
 */
async function hasClientAccess(
    supabase: any,
    advisorId: string,
    clientVaultId: string,
    ownerAdvisorId: string | null
): Promise<boolean> {
    // Admins bypass owner/follower gate so they can take advisor-side actions
    // on any client from the unified admin client view.
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        const { data: userRow } = await supabase
            .from("users")
            .select("role")
            .eq("id", user.id)
            .maybeSingle();
        if (userRow?.role === "admin") return true;
    }

    if (ownerAdvisorId && ownerAdvisorId === advisorId) return true;
    const { data: follower } = await supabase
        .from("client_followers")
        .select("id")
        .eq("client_vault_id", clientVaultId)
        .eq("advisor_id", advisorId)
        .maybeSingle();
    return !!follower;
}

/**
 * addManualFundingApplication
 * 
 * Allows an advisor to manually upload a signed funding application (contract)
 * for a client. 
 */
export async function addManualFundingApplication(clientId: string, formData: FormData, businessProfileId?: string | null) {
    try {
        const supabase = await createClient();

        // 1. Get authenticated advisor
        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) {
            throw new Error("Unauthorized");
        }

        const file = formData.get("file") as File;
        if (!file) {
            throw new Error("No file provided");
        }

        // 2. Verify client and get user_id
        const { data: client, error: clientError } = await supabase
            .from("client_data_vault")
            .select("user_id, ghl_contact_id, advisor_id")
            .eq("id", clientId)
            .single();

        if (clientError || !client) {
            throw new Error("Client not found");
        }

        // 3. Upload to storage
        const supabaseAdmin = createAdminClient();
        const fileName = `${Date.now()}_funding_application.pdf`;
        const storagePath = `${client.user_id}/${fileName}`;

        const { error: uploadError } = await supabaseAdmin.storage
            .from("user-documents")
            .upload(storagePath, file);

        if (uploadError) {
            throw new Error(`Upload failed: ${uploadError.message}`);
        }

        // The funding application is per-deal — scope to the active
        // business so it shows up only on that tab. Fall back to the
        // primary business when no active tab was passed.
        const { data: primary } = await supabaseAdmin
            .from("business_profiles")
            .select("id")
            .eq("client_vault_id", clientId)
            .eq("is_primary", true)
            .maybeSingle();
        const resolvedBusinessProfileId = businessProfileId ?? primary?.id ?? null;

        // 4. Create user_documents record
        const { data: doc, error: docError } = await supabaseAdmin
            .from("user_documents")
            .insert({
                user_id: client.user_id,
                name: file.name || "funding_application.pdf",
                size: file.size,
                type: file.type || "application/pdf",
                storage_path: storagePath,
                category: "funding_application",
                doc_code: "funding_application",
                business_profile_id: resolvedBusinessProfileId,
                status: "verified"
            })
            .select()
            .single();

        if (docError) {
            // Cleanup storage if DB fails
            await supabaseAdmin.storage.from("user-documents").remove([storagePath]);
            throw new Error(`Database error: ${docError.message}`);
        }

        // 5. Update client_data_vault
        const { error: vaultUpdateError } = await supabaseAdmin
            .from("client_data_vault")
            .update({
                contract_completed: true,
                contract_completed_at: new Date().toISOString()
            })
            .eq("id", clientId);

        if (vaultUpdateError) {
            console.error("Vault update error:", vaultUpdateError);
        }

        // 6. Update pipeline status
        await updateLoanStatus(clientId, "documents_received", "Funding application uploaded manually by advisor");

        // 7. Sync to GHL
        try {
            await ghlSyncDocument(supabaseAdmin, doc.id, client.user_id, "funding_application");
        } catch (ghlError) {
            console.error("GHL Sync Error (non-fatal):", ghlError);
        }

        revalidatePath(`/advisor/dashboard/clients/${clientId}`);
        revalidatePath(`/advisor/dashboard/clients`);

        return { success: true };
    } catch (error: any) {
        console.error("Exception in addManualFundingApplication:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}
/**
 * requestNewDocument
 * 
 * Allows an advisor to request a new document from a client.
 * Updates the database and syncs the request tag to GoHighLevel.
 */
/**
 * requestDocuments
 * 
 * Allows an advisor to request one or more new documents from a client.
 * Updates the database and syncs the request tags to GoHighLevel.
 */
export async function requestDocuments(clientId: string, documentIds: string[], businessProfileId?: string | null, statementMonths?: number | null) {
    try {
        if (!documentIds || documentIds.length === 0) {
            throw new Error("No documents selected");
        }

        const supabase = await createClient();

        // 1. Get authenticated advisor
        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) {
            throw new Error("Unauthorized");
        }

        // 2. Verify advisor ownership and get client user_id + ghl_contact_id
        const { data: client, error: clientError } = await supabase
            .from("client_data_vault")
            .select("user_id, ghl_contact_id, client_email, client_name, advisor_id")
            .eq("id", clientId)
            .single();

        if (clientError || !client) {
            console.error("Client fetch error or unauthorized:", clientError);
            throw new Error("Client not found or access denied");
        }

        // 3. Get document details for GHL tagging
        const { data: docDefs, error: docsError } = await supabase
            .from("required_documents")
            .select("id, code, ghl_tag")
            .in("id", documentIds);

        if (docsError || !docDefs || docDefs.length === 0) {
            throw new Error("Selected document types not found");
        }

        // 4. Resolve which business each request belongs to. Falls back to the
        // primary business for the caller-supplied default. Client-scoped doc
        // codes (driver's license, MyScoreIQ, PFS) are always pinned to the
        // primary so a single source of truth serves every business tab via
        // the matcher predicate on the read side.
        const supabaseAdmin = createAdminClient();
        const { data: primary } = await supabaseAdmin
            .from("business_profiles")
            .select("id")
            .eq("client_vault_id", clientId)
            .eq("is_primary", true)
            .maybeSingle();
        const primaryId = primary?.id ?? null;
        const defaultBusinessProfileId = businessProfileId ?? primaryId;

        // 5. Batch upsert into client_dynamic_documents scoped to that business.
        const dynamicsToInsert = documentIds.map(docId => {
            const def = docDefs.find((d: any) => d.id === docId);
            const code: string | undefined = def?.code;
            const bizId = isClientScopedDoc(code) ? primaryId : defaultBusinessProfileId;
            return {
                user_id: client.user_id,
                document_id: docId,
                business_profile_id: bizId,
                is_active: true,
                requested_at: new Date().toISOString(),
                // Bank statements carry a per-request month count; other docs ignore it.
                statement_months: code === 'business_bank_statements' ? (statementMonths ?? null) : null,
            };
        });

        const { error: insertError } = await supabaseAdmin
            .from("client_dynamic_documents")
            .upsert(dynamicsToInsert, { onConflict: 'business_profile_id, document_id' });

        if (insertError) {
            console.error("Error inserting dynamic documents:", insertError);
            throw new Error("Failed to update document requirements in database");
        }

        // 5a. Re-requesting a document means it must be (re)reviewed. Clear any
        // existing advisor approval for these codes (scoped to the same business
        // as the request) so the field drops from "Advisor Approved" back to
        // "waiting approval" (Ready for Review) until the new upload is approved.
        for (const def of docDefs) {
            const code: string | undefined = (def as any).code;
            if (!code) continue;
            const bizId = isClientScopedDoc(code) ? primaryId : defaultBusinessProfileId;
            const clearQuery = supabaseAdmin
                .from("document_category_approvals")
                .delete()
                .eq("client_vault_id", clientId)
                .eq("doc_code", code);
            if (bizId) {
                clearQuery.eq("business_profile_id", bizId);
            } else {
                clearQuery.is("business_profile_id", null);
            }
            const { error: clearErr } = await clearQuery;
            if (clearErr) {
                console.error(`Failed to clear approval for ${code} (non-fatal):`, clearErr);
            }
        }

        // 5. Update submission status to 'documents_requested'
        // This ensures the vault is no longer marked as 'locked' or 'submitted'
        const { error: statusError } = await supabaseAdmin
            .from("submissions")
            .upsert({
                user_id: client.user_id,
                status: 'documents_requested'
            }, { onConflict: 'user_id' });
        
        // 5.1 Update Loan Pipeline status
        await updateLoanStatus(clientId, 'documents_requested', `Advisor requested ${documentIds.length} new documents`);

        if (statusError) {
            console.error("Error updating submission status:", statusError);
        }

        // 6. GHL Sync: Add requested tags for each document
        if (client.ghl_contact_id) {
            const tagsToAdd = docDefs
                .map(d => d.ghl_tag)
                .filter(tag => !!tag) as string[];

            if (tagsToAdd.length > 0) {
                try {
                    await ghlAddTags(client.ghl_contact_id, tagsToAdd);
                    console.log(`✅ ${tagsToAdd.length} GHL tags added for contact ${client.ghl_contact_id}`);
                } catch (ghlError) {
                    console.error("GHL Sync Error (non-fatal):", ghlError);
                }
            }

            if (process.env.GHL_TOKEN) {
                const { syncOutstandingDocuments } = await import("@/lib/outstanding-documents");
                try {
                    await syncOutstandingDocuments(client.user_id, client.ghl_contact_id, process.env.GHL_TOKEN);
                    console.log(`✅ Synced outstanding docs after requesting new documents`);
                } catch (syncError) {
                    console.error("❌ Error syncing outstanding documents:", syncError);
                }
            }
        }

        // 7. MyScoreIQ side-effect: when the advisor requests a MyScoreIQ Report we
        //    also email the client the offer-coded signup link with instructions to
        //    share the report with Credit Banc. Non-fatal — request stands either way.
        if (docDefs.some(d => d.code === "myscoreiq") && client.client_email) {
            try {
                const { send_myscoreiq_setup_email } = await import("@/lib/email");
                let advisor_name: string | null = null;
                let advisor_email: string | null = null;
                if (client.advisor_id) {
                    const { data: advisorRow } = await supabaseAdmin
                        .from("advisors")
                        .select("first_name, last_name, email")
                        .eq("id", client.advisor_id)
                        .maybeSingle();
                    if (advisorRow) {
                        advisor_name = `${advisorRow.first_name ?? ""} ${advisorRow.last_name ?? ""}`.trim() || null;
                        advisor_email = advisorRow.email ?? null;
                    }
                }
                const { getFollowerEmailsForClient } = await import("@/lib/followers");
                const follower_emails = await getFollowerEmailsForClient(supabaseAdmin, clientId);
                const cc_emails = [advisor_email, ...follower_emails]
                    .filter((e): e is string => typeof e === "string" && e.includes("@"));

                await send_myscoreiq_setup_email({
                    client_email: client.client_email,
                    client_name: (client.client_name || "").split(" ")[0] || "there",
                    advisor_name,
                    advisor_email,
                    advisor_cc_emails: cc_emails,
                });
            } catch (emailError) {
                console.error("MyScoreIQ setup email failed (non-fatal):", emailError);
            }
        }

        // 8. Revalidate the client detail page
        revalidatePath(`/advisor/dashboard/clients/${clientId}`);

        return { success: true };
    } catch (error: any) {
        console.error("Exception in requestDocuments:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

/**
 * updateClientProfile
 * 
 * Allows an advisor to update a client's profile information.
 * Syncs changes to public.users, business_profiles, and GoHighLevel.
 */
/**
 * updateClientSignupNotes
 *
 * Inline-save for the two signup note fields on client_data_vault:
 * loan_purpose and additional_notes. Separate from updateClientProfile so
 * the new Client Notes card can persist just these fields without having to
 * resubmit the entire profile form.
 */
export async function updateClientSignupNotes(
    clientId: string,
    data: { loan_purpose?: string; additional_notes?: string }
) {
    try {
        const supabase = await createClient();

        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) throw new Error("Unauthorized");

        const { data: client, error: clientError } = await supabase
            .from("client_data_vault")
            .select("advisor_id")
            .eq("id", clientId)
            .single();
        if (clientError || !client) throw new Error("Client not found");

        const { data: advisorData } = await supabase
            .from("advisors")
            .select("id")
            .eq("user_id", advisorUser.id)
            .single();

        if (!advisorData || !(await hasClientAccess(supabase, advisorData.id, clientId, client.advisor_id))) {
            throw new Error("Access denied: You do not have access to this client");
        }

        const patch: Record<string, any> = { updated_at: new Date().toISOString() };
        if (typeof data.loan_purpose === "string") patch.loan_purpose = data.loan_purpose;
        if (typeof data.additional_notes === "string") patch.additional_notes = data.additional_notes;

        const supabaseAdmin = createAdminClient();
        const { error: updateError } = await supabaseAdmin
            .from("client_data_vault")
            .update(patch)
            .eq("id", clientId);

        if (updateError) throw new Error(`Failed to update notes: ${updateError.message}`);

        revalidatePath(`/advisor/dashboard/clients/${clientId}`);

        return { success: true };
    } catch (error: any) {
        console.error("Exception in updateClientSignupNotes:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

/**
 * setReferralPartner
 *
 * Persists the selected referral partner (a.k.a. affiliate) on the client
 * vault and syncs the same string to the GHL contact custom field
 * AFFILIATE_ASSIGNED so GHL automations keyed on that field fire.
 *
 * Pass `null` to clear the assignment.
 */
export async function setReferralPartner(clientId: string, partnerName: string | null) {
    try {
        const supabase = await createClient();

        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) throw new Error("Unauthorized");

        const { data: client, error: clientError } = await supabase
            .from("client_data_vault")
            .select("advisor_id, ghl_contact_id")
            .eq("id", clientId)
            .single();
        if (clientError || !client) throw new Error("Client not found");

        const { data: advisorData } = await supabase
            .from("advisors")
            .select("id")
            .eq("user_id", advisorUser.id)
            .single();

        if (!advisorData || !(await hasClientAccess(supabase, advisorData.id, clientId, client.advisor_id))) {
            throw new Error("Access denied: You do not have access to this client");
        }

        const supabaseAdmin = createAdminClient();
        const { error: updateError } = await supabaseAdmin
            .from("client_data_vault")
            .update({
                referral_partner: partnerName,
                updated_at: new Date().toISOString(),
            })
            .eq("id", clientId);

        if (updateError) throw new Error(`Failed to update referral partner: ${updateError.message}`);

        // Sync to GHL — non-fatal if this fails; vault is source of truth.
        const affiliateFieldId = process.env.AFFILIATE_ASSIGNED;
        if (client.ghl_contact_id && affiliateFieldId) {
            try {
                await ghlUpdateContact(client.ghl_contact_id, {
                    customFields: [{ id: affiliateFieldId, value: partnerName ?? "" }],
                });
            } catch (ghlError) {
                console.error("[setReferralPartner] GHL sync failed (non-fatal):", ghlError);
            }
        }

        revalidatePath(`/advisor/dashboard/clients/${clientId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Exception in setReferralPartner:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

export async function updateClientProfile(clientId: string, data: any) {
    try {
        const supabase = await createClient();

        // 1. Get authenticated advisor
        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) {
            throw new Error("Unauthorized");
        }

        // 2. Verify advisor ownership and get critical fields
        const { data: client, error: clientError } = await supabase
            .from("client_data_vault")
            .select("user_id, ghl_contact_id, advisor_id")
            .eq("id", clientId)
            .single();

        if (clientError || !client) {
            throw new Error("Client not found");
        }

        // Verify advisor ownership via advisor record
        const { data: advisorData } = await supabase
            .from("advisors")
            .select("id")
            .eq("user_id", advisorUser.id)
            .single();

        if (!advisorData || !(await hasClientAccess(supabase, advisorData.id, clientId, client.advisor_id))) {
            throw new Error("Access denied: You do not have access to this client");
        }

        const supabaseAdmin = createAdminClient();
        const newEmail = data.client_email.trim().toLowerCase();

        // Canonicalise the phone the same way signup does: display form in the
        // vault, E.164 to GHL. The client-side schema already rejects partials,
        // so anything invalid here came from a non-form caller.
        if (!isValidUsPhone(data.client_phone)) {
            throw new Error("Enter a valid 10-digit US phone number.");
        }
        const newPhone = formatPhoneUS(data.client_phone);
        const newPhoneE164 = toE164(newPhone)!;

        // 2b. Pre-flight: check if the new email is already taken by a DIFFERENT auth user
        const { data: existingAuthUsers } = await supabaseAdmin.auth.admin.listUsers({
            perPage: 1000,
        });
        const emailConflict = existingAuthUsers?.users?.find(
            (u) => u.email?.toLowerCase() === newEmail && u.id !== client.user_id
        );
        if (emailConflict) {
            throw new Error(
                `The email "${newEmail}" is already registered to another account. Please use a different email address.`
            );
        }

        // 3. Update client_data_vault
        const { error: updateError } = await supabaseAdmin
            .from("client_data_vault")
            .update({
                client_name: data.client_name,
                client_email: newEmail,
                client_phone: newPhone,
                company_name: data.company_name,
                company_city: data.company_city,
                company_state: data.company_state,
                company_zip_code: data.company_zip_code,
                capital_requested: data.capital_requested,
                avg_monthly_deposits: data.avg_monthly_deposits,
                avg_annual_revenue: data.avg_annual_revenue,
                credit_score: data.credit_score,
                legal_entity_type: data.legal_entity_type,
                business_start_date: data.business_start_date,
                loan_purpose: data.loan_purpose,
                proposed_loan_type: data.proposed_loan_type,
                funding_eta: data.funding_eta,
                employees_count: data.employees_count,
                is_home_based: data.is_home_based,
                updated_at: new Date().toISOString()
            })
            .eq("id", clientId);

        if (updateError) {
            throw new Error(`Failed to update vault: ${updateError.message}`);
        }

        // 4. Sync to Unified Tables (users, business_profiles)
        await syncUnifiedClientData(supabaseAdmin, {
            userId: client.user_id,
            email: newEmail,
            clientName: data.client_name,
            companyName: data.company_name,
            phone: newPhone,
            city: data.company_city,
            state: data.company_state,
            zipCode: data.company_zip_code
        });

        // 4b. Sync email to Supabase Auth (so client can log in with new email)
        const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(
            client.user_id,
            { email: newEmail }
        );

        if (authUpdateError) {
            console.error("[updateClientProfile] Auth email sync failed:", authUpdateError.message);
            // Surface this as a real error — the email was saved in the vault but auth is out of sync
            throw new Error(
                `Profile data saved, but auth login email could not be updated: ${authUpdateError.message}. Please contact support.`
            );
        } else {
            console.log(`✅ Auth email updated to ${newEmail} for user ${client.user_id}`);
        }

        // 5. GHL Sync: Update contact info (skip email field if it would cause a duplicate conflict)
        if (client.ghl_contact_id) {
            try {
                await ghlUpdateContact(client.ghl_contact_id, {
                    firstName: data.client_name.split(' ')[0],
                    lastName: data.client_name.split(' ').slice(1).join(' ') || '',
                    email: newEmail,
                    phone: newPhoneE164,
                    companyName: data.company_name,
                    city: data.company_city,
                    state: data.company_state,
                    postalCode: data.company_zip_code,
                });
            } catch (ghlError: any) {
                const isDuplicateEmailError =
                    typeof ghlError?.message === "string" &&
                    ghlError.message.includes("duplicated contacts");

                if (isDuplicateEmailError) {
                    // Retry without the identity fields — email AND phone are both
                    // dedupe keys in GHL, so dropping only the email still collides
                    // when it's the phone that belongs to another contact.
                    console.warn("[GHL] Duplicate conflict on update — retrying without email/phone.");
                    try {
                        await ghlUpdateContact(client.ghl_contact_id, {
                            firstName: data.client_name.split(' ')[0],
                            lastName: data.client_name.split(' ').slice(1).join(' ') || '',
                            companyName: data.company_name,
                            city: data.company_city,
                            state: data.company_state,
                            postalCode: data.company_zip_code,
                        });
                        console.warn("[GHL] Contact updated without email/phone (duplicate conflict in GHL).");
                    } catch (retryError) {
                        console.error("GHL retry also failed (non-fatal):", retryError);
                    }
                } else {
                    console.error("GHL Sync Error (non-fatal):", ghlError);
                }
            }
        }

        // 6. Revalidate
        revalidatePath(`/advisor/dashboard/clients/${clientId}`);

        return { success: true };
    } catch (error: any) {
        console.error("Exception in updateClientProfile:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

/**
 * updateBusinessProfile
 *
 * Per-business edit. Used when the advisor edits a NON-PRIMARY business tab.
 * Business + funding-ask fields are written to that business's own rows
 * (business_profiles + funding_deals), NOT to client_data_vault — so editing
 * "Business B" never clobbers "Business A" / the primary's figures. Shared
 * client identity (name / email / phone / credit score) still lives on the
 * client and is updated on client_data_vault (with auth + GHL sync) since it's
 * the same human across every business.
 *
 * The PRIMARY business keeps using updateClientProfile (the legacy fat
 * client_data_vault row is its source of truth).
 */
export async function updateBusinessProfile(clientId: string, businessProfileId: string, data: any) {
    try {
        const supabase = await createClient();

        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) throw new Error("Unauthorized");

        const { data: client, error: clientError } = await supabase
            .from("client_data_vault")
            .select("user_id, ghl_contact_id, advisor_id")
            .eq("id", clientId)
            .single();
        if (clientError || !client) throw new Error("Client not found");

        // Access: admin bypasses (hasClientAccess), advisors must own/follow.
        const { data: advisorData } = await supabase
            .from("advisors").select("id").eq("user_id", advisorUser.id).maybeSingle();
        if (!(await hasClientAccess(supabase, advisorData?.id ?? "", clientId, client.advisor_id))) {
            throw new Error("Access denied: You do not have access to this client");
        }

        const supabaseAdmin = createAdminClient();

        // Guard: the business must belong to THIS client (no cross-client writes).
        const { data: biz, error: bizErr } = await supabaseAdmin
            .from("business_profiles")
            .select("id, is_primary")
            .eq("id", businessProfileId)
            .eq("client_vault_id", clientId)
            .maybeSingle();
        if (bizErr || !biz) throw new Error("Business not found for this client");

        const num = (v: any): number | null => {
            if (v === null || v === undefined || v === "") return null;
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        };

        // 1. Business-scoped fields → business_profiles.
        const { error: bpErr } = await supabaseAdmin
            .from("business_profiles")
            .update({
                company_name: data.company_name,
                business_name: data.company_name,
                company_city: data.company_city || null,
                company_state: data.company_state || null,
                company_zip_code: data.company_zip_code || null,
                legal_entity_type: data.legal_entity_type || null,
                business_start_date: data.business_start_date || null,
                avg_monthly_deposits: num(data.avg_monthly_deposits),
                avg_annual_revenue: num(data.avg_annual_revenue),
                employees_count: num(data.employees_count),
                is_home_based: data.is_home_based ?? false,
                // Legacy mirror columns.
                city: data.company_city || null,
                state: data.company_state || null,
                zip: data.company_zip_code || null,
                updated_at: new Date().toISOString(),
            })
            .eq("id", businessProfileId);
        if (bpErr) throw new Error(`Failed to update business: ${bpErr.message}`);

        // 2. Funding-ask fields → the business's funding_deals row (lowest
        //    display_order). Create one if missing so the ask always has a home.
        const dealPayload = {
            capital_requested: num(data.capital_requested),
            proposed_loan_type: data.proposed_loan_type || null,
            loan_purpose: data.loan_purpose || null,
            funding_eta: data.funding_eta || null,
        };
        const { data: deals } = await supabaseAdmin
            .from("funding_deals")
            .select("id")
            .eq("business_profile_id", businessProfileId)
            .order("display_order", { ascending: true })
            .limit(1);
        if (deals && deals.length > 0) {
            const { error: dealErr } = await supabaseAdmin
                .from("funding_deals").update(dealPayload).eq("id", deals[0].id);
            if (dealErr) throw new Error(`Failed to update funding deal: ${dealErr.message}`);
        } else {
            const { error: dealErr } = await supabaseAdmin
                .from("funding_deals")
                .insert({ business_profile_id: businessProfileId, display_order: 0, ...dealPayload });
            if (dealErr) throw new Error(`Failed to create funding deal: ${dealErr.message}`);
        }

        // 3. Shared client identity → client_data_vault. Email change is
        //    conflict-checked + synced to auth, mirroring updateClientProfile.
        const newEmail = (data.client_email || "").trim().toLowerCase();
        // Same phone contract as updateClientProfile: display form stored,
        // E.164 pushed to GHL. Only touch it when a value was actually sent.
        const identityUpdate: any = {
            client_name: data.client_name,
            credit_score: data.credit_score,
            updated_at: new Date().toISOString(),
        };
        let identityPhoneE164: string | null = null;
        if (data.client_phone) {
            if (!isValidUsPhone(data.client_phone)) {
                throw new Error("Enter a valid 10-digit US phone number.");
            }
            identityUpdate.client_phone = formatPhoneUS(data.client_phone);
            identityPhoneE164 = toE164(data.client_phone);
        }
        let emailChanged = false;
        if (newEmail) {
            const { data: vaultRow } = await supabaseAdmin
                .from("client_data_vault").select("client_email").eq("id", clientId).maybeSingle();
            if (vaultRow && (vaultRow.client_email || "").toLowerCase() !== newEmail) {
                const { data: existingAuthUsers } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
                const conflict = existingAuthUsers?.users?.find(
                    (u) => u.email?.toLowerCase() === newEmail && u.id !== client.user_id
                );
                if (conflict) throw new Error(`The email "${newEmail}" is already registered to another account.`);
                identityUpdate.client_email = newEmail;
                emailChanged = true;
            }
        }
        const { error: idErr } = await supabaseAdmin
            .from("client_data_vault").update(identityUpdate).eq("id", clientId);
        if (idErr) throw new Error(`Failed to update client: ${idErr.message}`);

        if (emailChanged) {
            const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(client.user_id, { email: newEmail });
            if (authErr) throw new Error(`Profile saved, but auth login email could not be updated: ${authErr.message}. Please contact support.`);
        }

        // GHL: sync client identity ONLY. The GHL contact is per-client — never
        // overwrite its company/location with a secondary business's fields.
        if (client.ghl_contact_id) {
            try {
                await ghlUpdateContact(client.ghl_contact_id, {
                    firstName: (data.client_name || "").split(" ")[0],
                    lastName: (data.client_name || "").split(" ").slice(1).join(" ") || "",
                    ...(emailChanged ? { email: newEmail } : {}),
                    ...(identityPhoneE164 ? { phone: identityPhoneE164 } : {}),
                });
            } catch (ghlError) {
                console.error("GHL identity sync (non-fatal):", ghlError);
            }
        }

        revalidatePath(`/advisor/dashboard/clients/${clientId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Exception in updateBusinessProfile:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

/**
 * deleteClientFile
 * 
 * Allows an advisor to delete a document uploaded by a client.
 * Verifies ownership before removing from storage and database.
 */
export async function deleteClientFile(clientId: string, documentId: string) {
    try {
        const supabase = await createClient();

        // 1. Get authenticated advisor
        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) throw new Error("Unauthorized");

        // 2. Verify advisor ownership
        const { data: client, error: clientError } = await supabase
            .from("client_data_vault")
            .select("id, advisor_id, user_id, ghl_contact_id")
            .eq("id", clientId)
            .single();

        if (clientError || !client) throw new Error("Client not found");

        const { data: advisorData } = await supabase
            .from("advisors")
            .select("id")
            .eq("user_id", advisorUser.id)
            .single();

        if (!advisorData || !(await hasClientAccess(supabase, advisorData.id, clientId, client.advisor_id))) {
            throw new Error("Access denied: You do not have access to this client");
        }

        // 3. Get document storage path
        const { data: doc, error: docError } = await supabase
            .from("user_documents")
            .select("storage_path, name")
            .eq("id", documentId)
            .single();

        if (docError || !doc) throw new Error("Document not found");

        const supabaseAdmin = createAdminClient();

        // 4. Delete from Storage
        const { error: storageError } = await supabaseAdmin.storage
            .from("user-documents")
            .remove([doc.storage_path]);

        if (storageError) {
            console.error("Storage deletion error:", storageError);
        }

        // 5. Delete from Database
        const { error: dbError } = await supabaseAdmin
            .from("user_documents")
            .delete()
            .eq("id", documentId);

        if (dbError) throw new Error(`Failed to delete document record: ${dbError.message}`);

        if (client.ghl_contact_id && process.env.GHL_TOKEN) {
            const { syncOutstandingDocuments } = await import("@/lib/outstanding-documents");
            await syncOutstandingDocuments(client.user_id, client.ghl_contact_id, process.env.GHL_TOKEN);
        }

        // 6. Revalidate
        revalidatePath(`/advisor/dashboard/clients/${clientId}`);

        return { success: true };
    } catch (error: any) {
        console.error("Exception in deleteClientFile:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

/**
 * deleteClientVault
 * 
 * Permanently deletes a client's data vault and associated records.
 */
export async function deleteClientVault(clientId: string) {
    try {
        const supabase = await createClient();

        // 1. Get authenticated advisor
        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) throw new Error("Unauthorized");

        // 2. Verify advisor ownership
        const { data: client, error: clientError } = await supabase
            .from("client_data_vault")
            .select("id, advisor_id, user_id")
            .eq("id", clientId)
            .single();

        if (clientError || !client) throw new Error("Client not found");

        const { data: advisorData } = await supabase
            .from("advisors")
            .select("id")
            .eq("user_id", advisorUser.id)
            .single();

        if (!advisorData || !(await hasClientAccess(supabase, advisorData.id, clientId, client.advisor_id))) {
            throw new Error("Access denied: You do not have access to this client");
        }

        const supabaseAdmin = createAdminClient();

        // 3. Remove the client's files from Storage. The DB rows cascade via
        //    auth.users below, but Storage objects don't — they have to go
        //    explicitly or they'll orphan in the bucket.
        const { data: docs } = await supabaseAdmin
            .from("user_documents")
            .select("storage_path")
            .eq("user_id", client.user_id);

        if (docs && docs.length > 0) {
            const paths = docs.map(d => d.storage_path).filter(Boolean);
            if (paths.length > 0) {
                await supabaseAdmin.storage.from("user-documents").remove(paths);
            }
        }

        // 4. One-shot cascade. Deleting the auth.users row triggers ON DELETE
        //    CASCADE through public.users + client_data_vault + business_profiles
        //    + funding_deals + every dependent table (docs, dynamic docs, notes,
        //    pipeline history, lender assignments, bank analyses, followers,
        //    notifications, credit reports, etc.). Nothing left behind.
        const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(client.user_id);

        if (authDeleteError) {
            throw new Error(`Failed to delete client: ${authDeleteError.message}`);
        }

        return { success: true };
    } catch (error: any) {
        console.error("Exception in deleteClientVault:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

/**
 * reassignClientAdvisor
 *
 * Admin-only action: change the primary advisor on a client_data_vault row.
 * Followers are normally left to ClientFollowersCard, with two exceptions here:
 * the new owner is removed from the followers list, and — when handing off TO
 * the catch-all advisor — the previous advisor is added as a follower so they
 * keep visibility (mirrors the auto-reassign cron).
 * Stamps client_data_vault.advisor_name from the new advisor's record
 * so downstream emails/UI stay consistent. Pipeline state and documents are
 * untouched — only the assignment changes.
 */
export async function reassignClientAdvisor(clientId: string, newAdvisorId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Unauthorized" };

        // Admin role required.
        const { data: callerRow } = await supabase
            .from("users")
            .select("role")
            .eq("id", user.id)
            .maybeSingle();
        if (callerRow?.role !== "admin") {
            return { success: false, error: "Only admins can reassign advisors." };
        }

        const supabaseAdmin = createAdminClient();

        // Resolve the new advisor's display name (+ ghl_user_id to mirror
        // ownership back to GHL).
        const { data: newAdvisor, error: advisorErr } = await supabaseAdmin
            .from("advisors")
            .select("id, first_name, last_name, email, is_active, ghl_user_id")
            .eq("id", newAdvisorId)
            .maybeSingle();
        if (advisorErr || !newAdvisor) {
            return { success: false, error: "New advisor not found." };
        }
        if (newAdvisor.is_active === false) {
            return { success: false, error: "The selected advisor is inactive." };
        }

        const advisor_name =
            `${newAdvisor.first_name ?? ""} ${newAdvisor.last_name ?? ""}`.trim() || "Unknown";

        // Is this a hand-off TO the catch-all advisor? That path starts the
        // "Stale" clock and notifies the catch-all advisor, exactly like the
        // auto-reassign cron. Reassigning to anyone else clears that clock.
        const catchAll = await resolveCatchAllAdvisor(supabaseAdmin);
        const isToCatchAll = !!catchAll && newAdvisorId === catchAll.id;

        // Capture the previous advisor for the audit note + notification email.
        const { data: existing } = await supabaseAdmin
            .from("client_data_vault")
            .select("advisor_id, advisor_name, client_name, company_name, capital_requested, ghl_contact_id")
            .eq("id", clientId)
            .maybeSingle();

        const now_iso = new Date().toISOString();
        const { error: updateErr } = await supabaseAdmin
            .from("client_data_vault")
            .update({
                advisor_id: newAdvisorId,
                advisor_name,
                reassigned_to_catch_all_at: isToCatchAll ? now_iso : null,
                updated_at: now_iso,
            })
            .eq("id", clientId);

        if (updateErr) {
            return { success: false, error: `Failed to reassign: ${updateErr.message}` };
        }

        // Drop the new primary advisor from the followers list if present
        // (a follower can't also be the owner — they'd just be the owner).
        await supabaseAdmin
            .from("client_followers")
            .delete()
            .eq("client_vault_id", clientId)
            .eq("advisor_id", newAdvisorId);

        // When handing off TO the catch-all advisor, preserve the PREVIOUS
        // advisor as a follower so they keep visibility on a file that was
        // taken from them. This mirrors the auto-reassign cron
        // (api/cron/reassign-stale-files). Normal reassignments intentionally
        // do NOT do this (see the note above) — ClientFollowersCard manages
        // those.
        if (isToCatchAll && existing?.advisor_id && existing.advisor_id !== newAdvisorId) {
            const { error: followerErr } = await supabaseAdmin
                .from("client_followers")
                .insert({
                    client_vault_id: clientId,
                    advisor_id: existing.advisor_id,
                    assigned_by: newAdvisorId,
                });
            // 23505 = already a follower; harmless, don't surface it.
            if (followerErr && (followerErr as { code?: string }).code !== "23505") {
                console.error(
                    "reassignClientAdvisor: failed to add previous advisor as follower:",
                    followerErr
                );
            }
        }

        // Mirror the new owner into GHL so the contact owner tracks the vault
        // advisor (keeps GHL ownership in sync with reassignments). Non-fatal.
        if (existing?.ghl_contact_id && newAdvisor.ghl_user_id) {
            try {
                await ghlUpdateContact(existing.ghl_contact_id, {
                    assignedTo: newAdvisor.ghl_user_id,
                });
            } catch (ghlErr) {
                console.error("reassignClientAdvisor: GHL owner sync failed:", ghlErr);
            }
        }

        // (loan_status_history requires a valid status enum value, so we
        // don't write an audit entry here. The change is visible via
        // client_data_vault.updated_at and the previous owner is captured
        // on the response below.)
        const previous_advisor_id = existing?.advisor_id ?? null;
        const previous_advisor_name = existing?.advisor_name ?? null;

        // Notify the catch-all advisor (in-app + email), mirroring the cron.
        if (isToCatchAll && catchAll) {
            if (catchAll.user_id) {
                await supabaseAdmin.from("in_app_notifications").insert({
                    user_id: catchAll.user_id,
                    client_id: clientId,
                    title: "Client reassigned to you",
                    message: `${existing?.client_name || "A client"}${existing?.company_name ? ` (${existing.company_name})` : ""} has been reassigned to you. Please reach out as soon as possible.`,
                });
            }
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
            try {
                await send_file_reassignment_notification({
                    advisor_name: catchAll.name,
                    advisor_email: catchAll.email,
                    files: [{
                        client_name: existing?.client_name || "",
                        company_name: existing?.company_name || "",
                        capital_requested: existing?.capital_requested ?? null,
                        previous_advisor_name,
                        inactivity_days: 0,
                        detail_url: `${appUrl}/admin/clients/${clientId}`,
                    }],
                    login_url: `${appUrl}/admin/pipeline`,
                });
            } catch (mailErr) {
                console.error("reassignClientAdvisor: catch-all email failed:", mailErr);
            }
        }

        revalidatePath(`/admin/clients/${clientId}`);
        revalidatePath(`/advisor/dashboard/clients/${clientId}`);

        return {
            success: true,
            advisor_name,
            previous_advisor_id,
            previous_advisor_name,
        };
    } catch (error: any) {
        console.error("Exception in reassignClientAdvisor:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

/**
 * setReassignmentPause
 *
 * Pauses (or resumes) auto-reassignment of a file to the catch-all advisor.
 * Pass a positive number of days to pause that long from now; pass null to
 * resume immediately. Admins and the owning/following advisor may call it.
 * The reassign-stale-files cron skips any file whose reassignment_paused_until
 * is still in the future.
 */
export async function setReassignmentPause(clientId: string, pauseDays: number | null) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Unauthorized" };

        const { data: client, error: clientErr } = await supabase
            .from("client_data_vault")
            .select("advisor_id")
            .eq("id", clientId)
            .maybeSingle();
        if (clientErr || !client) return { success: false, error: "Client not found" };

        // Access: admins always; otherwise the owning/following advisor.
        const { data: callerRow } = await supabase
            .from("users")
            .select("role")
            .eq("id", user.id)
            .maybeSingle();
        if (callerRow?.role !== "admin") {
            const { data: advisorData } = await supabase
                .from("advisors")
                .select("id")
                .eq("user_id", user.id)
                .maybeSingle();
            if (!advisorData || !(await hasClientAccess(supabase, advisorData.id, clientId, client.advisor_id))) {
                return { success: false, error: "Access denied" };
            }
        }

        // null/0/negative → resume. Otherwise pause `pauseDays` from now.
        const paused_until =
            pauseDays && pauseDays > 0
                ? new Date(Date.now() + pauseDays * 86_400_000).toISOString()
                : null;

        const supabaseAdmin = createAdminClient();
        const { error: updateErr } = await supabaseAdmin
            .from("client_data_vault")
            .update({ reassignment_paused_until: paused_until })
            .eq("id", clientId);
        if (updateErr) {
            return { success: false, error: `Failed to update pause: ${updateErr.message}` };
        }

        revalidatePath(`/admin/clients/${clientId}`);
        revalidatePath(`/advisor/dashboard/clients/${clientId}`);

        return { success: true, paused_until };
    } catch (error: any) {
        console.error("Exception in setReassignmentPause:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

/**
 * removeRequestedDocument
 *
 * Allows an advisor to remove a document request (dynamic document).
 */
export async function removeRequestedDocument(clientId: string, documentCode: string, businessProfileId?: string | null) {
    try {
        const supabase = await createClient();

        // 1. Get authenticated advisor
        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) throw new Error("Unauthorized");

        // 2. Verify advisor ownership
        const { data: client, error: clientError } = await supabase
            .from("client_data_vault")
            .select("id, advisor_id, user_id")
            .eq("id", clientId)
            .single();

        if (clientError || !client) throw new Error("Client not found");

        const { data: advisorData } = await supabase
            .from("advisors")
            .select("id")
            .eq("user_id", advisorUser.id)
            .single();

        if (!advisorData || !(await hasClientAccess(supabase, advisorData.id, clientId, client.advisor_id))) {
            throw new Error("Access denied: You do not have access to this client");
        }

        // 3. Get document ID from code
        const { data: docDef, error: docDefError } = await supabase
            .from("required_documents")
            .select("id")
            .eq("code", documentCode)
            .single();

        if (docDefError || !docDef) throw new Error("Document type not found");

        const supabaseAdmin = createAdminClient();

        // Resolve which business this removal targets. Mirrors
        // requestDocuments / approveDocumentCategory: client-scoped doc
        // codes target the primary so the single shared row is removed,
        // business-scoped codes target the active tab so a sibling
        // business's request isn't collaterally wiped.
        const { data: primary } = await supabaseAdmin
            .from("business_profiles")
            .select("id")
            .eq("client_vault_id", clientId)
            .eq("is_primary", true)
            .maybeSingle();
        const primaryId = primary?.id ?? null;
        const resolvedBusinessProfileId = isClientScopedDoc(documentCode)
            ? primaryId
            : (businessProfileId ?? primaryId);

        // 4. Delete from client_dynamic_documents, scoped to this business.
        const deleteQuery = supabaseAdmin
            .from("client_dynamic_documents")
            .delete()
            .eq("user_id", client.user_id)
            .eq("document_id", docDef.id);
        if (resolvedBusinessProfileId) {
            deleteQuery.eq("business_profile_id", resolvedBusinessProfileId);
        } else {
            deleteQuery.is("business_profile_id", null);
        }
        const { error: deleteError } = await deleteQuery;

        if (deleteError) throw new Error(`Failed to remove document request: ${deleteError.message}`);

        // 5. Check if completion is now 100% and update status if needed
        // (Optional: we could leave it as is and let the UI/advisor handle it,
        // but for a truly dynamic feel, we might want to reset if it was 'documents_requested')

        // 6. Revalidate
        revalidatePath(`/advisor/dashboard/clients/${clientId}`);

        return { success: true };
    } catch (error: any) {
        console.error("Exception in removeRequestedDocument:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

/**
 * approveDocumentCategory
 * 
 * Allows an advisor to mark a category as approved.
 */
export async function approveDocumentCategory(clientId: string, docCode: string, businessProfileId?: string | null) {
    try {
        const supabase = await createClient();
        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) throw new Error("Unauthorized");

        const { data: client } = await supabase
            .from("client_data_vault")
            .select("id, advisor_id, user_id, ghl_contact_id")
            .eq("id", clientId)
            .single();

        if (!client) throw new Error("Client not found");

        const { data: advisorData } = await supabase
            .from("advisors")
            .select("id")
            .eq("user_id", advisorUser.id)
            .single();

        if (!advisorData || !(await hasClientAccess(supabase, advisorData.id, clientId, client.advisor_id))) {
            throw new Error("Access denied");
        }

        const supabaseAdmin = createAdminClient();
        // Resolve which business this approval belongs to. Callers pass the
        // active tab; client-scoped doc codes (driver's license, MyScoreIQ,
        // PFS) always stamp against the primary so one approval row serves
        // every business tab (the read-side matcher surfaces it on all tabs).
        const { data: primary } = await supabaseAdmin
            .from("business_profiles")
            .select("id")
            .eq("client_vault_id", clientId)
            .eq("is_primary", true)
            .maybeSingle();
        const primaryId = primary?.id ?? null;

        const resolvedBusinessProfileId = isClientScopedDoc(docCode)
            ? primaryId
            : (businessProfileId ?? primaryId);

        const { error } = await supabaseAdmin
            .from("document_category_approvals")
            .upsert({
                client_vault_id: clientId,
                business_profile_id: resolvedBusinessProfileId,
                doc_code: docCode,
                approved_by: advisorUser.id,
                approved_at: new Date().toISOString()
            }, { onConflict: 'business_profile_id, doc_code' });

        if (error) {
            console.error("Supabase error in approveDocumentCategory:", error);
            throw error;
        }

        // 4. Clear 'rejected' status on documents in this category
        await supabaseAdmin
            .from("user_documents")
            .update({ status: 'ready', metadata: {} }) // Clear rejection reason too
            .eq("user_id", client.user_id)
            .eq("doc_code", docCode)
            .eq("status", "rejected");

        if (client.ghl_contact_id && process.env.GHL_TOKEN) {
            const { syncOutstandingDocuments } = await import("@/lib/outstanding-documents");
            await syncOutstandingDocuments(client.user_id, client.ghl_contact_id, process.env.GHL_TOKEN);

            // If this approval was the last one — every required doc is now
            // advisor-approved — tag the GHL contact so the doc-chase bot stops.
            // Add-only and self-contained: nothing else in the vault/UW flow is
            // touched. Non-fatal so it can't block the approval.
            try {
                const { isVaultFullyApproved, VAULT_COMPLETED_TAG } = await import("@/lib/outstanding-documents");
                if (await isVaultFullyApproved(client.user_id)) {
                    await ghlAddTags(client.ghl_contact_id, [VAULT_COMPLETED_TAG]);
                    console.log(`✅ ${VAULT_COMPLETED_TAG} tag added for client ${clientId}`);
                }
            } catch (tagErr) {
                console.error("⚠️ vault_completed tag failed (non-fatal):", tagErr);
            }
        }

        revalidatePath(`/advisor/dashboard/clients/${clientId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Exception in approveDocumentCategory:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

/**
 * rejectDocumentCategory
 * 
 * Allows an advisor to reject a document category, notify the client,
 * and provide feedback on why it was rejected.
 */
export async function rejectDocumentCategory(clientId: string, docCode: string, docLabel: string, reason: string, businessProfileId?: string | null) {
    try {
        const supabase = await createClient();
        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) throw new Error("Unauthorized");

        // 1. Verify advisor ownership
        const { data: client } = await supabase
            .from("client_data_vault")
            .select("id, advisor_id, client_email, client_name, user_id, ghl_contact_id")
            .eq("id", clientId)
            .single();

        if (!client) throw new Error("Client not found");

        const { data: advisorData } = await supabase
            .from("advisors")
            .select("id, first_name, last_name, email")
            .eq("user_id", advisorUser.id)
            .single();

        if (!advisorData || !(await hasClientAccess(supabase, advisorData.id, clientId, client.advisor_id))) {
            throw new Error("Access denied");
        }

        const supabaseAdmin = createAdminClient();

        // Resolve the business this rejection belongs to. Mirrors
        // approveDocumentCategory: client-scoped doc codes (DL/MyScoreIQ/PFS)
        // always target the primary business so a single row serves every
        // tab via the read-side matcher.
        const { data: primary } = await supabaseAdmin
            .from("business_profiles")
            .select("id")
            .eq("client_vault_id", clientId)
            .eq("is_primary", true)
            .maybeSingle();
        const primaryId = primary?.id ?? null;
        const resolvedBusinessProfileId = isClientScopedDoc(docCode)
            ? primaryId
            : (businessProfileId ?? primaryId);

        // 2. Delete any existing approval, scoped to this business. Without
        // the business scope, rejecting on Business B used to wipe Business
        // A's approval for the same doc code — data corruption visible to
        // the client.
        {
            const approvalDelete = supabaseAdmin
                .from("document_category_approvals")
                .delete()
                .eq("client_vault_id", clientId)
                .eq("doc_code", docCode);
            if (resolvedBusinessProfileId) {
                approvalDelete.eq("business_profile_id", resolvedBusinessProfileId);
            } else {
                approvalDelete.is("business_profile_id", null);
            }
            await approvalDelete;
        }

        // 3. Update documents in this category to 'rejected' status and
        // store reason — scoped to the same business so uploads on a
        // sibling business aren't flipped to rejected.
        const userDocsUpdate = supabaseAdmin
            .from("user_documents")
            .update({
                status: 'rejected',
                metadata: {
                    rejection_reason: reason,
                    rejected_at: new Date().toISOString(),
                    rejected_by: advisorUser.id
                }
            })
            .eq("user_id", client.user_id)
            .eq("doc_code", docCode);
        if (resolvedBusinessProfileId && !isClientScopedDoc(docCode)) {
            userDocsUpdate.eq("business_profile_id", resolvedBusinessProfileId);
        }
        const { error: updateError } = await userDocsUpdate;

        if (updateError) {
            console.error("❌ Error updating document status:", updateError);
        } else {
            console.log(`✅ Documents in ${docCode} marked as rejected with reason: ${reason}`);
        }

        // 4. Create In-App Notification
        await supabaseAdmin
            .from("in_app_notifications")
            .insert({
                user_id: client.user_id,
                client_id: clientId,
                title: `Action Required: ${docLabel}`,
                message: `Your advisor has requested a replacement for ${docLabel}. Reason: ${reason}`
            });

        // 5. Send Email Notification (CC primary advisor + followers)
        try {
            const { send_document_rejection_email } = await import("@/lib/email");
            const { getFollowerEmailsForClient } = await import("@/lib/followers");
            const follower_emails = await getFollowerEmailsForClient(supabaseAdmin, clientId);
            const cc_emails = [advisorData.email, ...follower_emails]
                .filter((e): e is string => typeof e === "string" && e.includes("@"));

            await send_document_rejection_email({
                client_name: client.client_name,
                client_email: client.client_email,
                doc_label: docLabel,
                rejection_reason: reason,
                advisor_name: `${advisorData.first_name} ${advisorData.last_name}`,
                advisor_cc_emails: cc_emails,
                login_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://vault.creditbanc.io'}/auth/login`
            });
        } catch (emailErr) {
            console.error("Failed to send rejection email:", emailErr);
        }

        if (client.ghl_contact_id && process.env.GHL_TOKEN) {
            const { syncOutstandingDocuments } = await import("@/lib/outstanding-documents");
            await syncOutstandingDocuments(client.user_id, client.ghl_contact_id, process.env.GHL_TOKEN);
        }

        revalidatePath(`/advisor/dashboard/clients/${clientId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Exception in rejectDocumentCategory:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

/**
 * renameClientFile
 * 
 * Allows an advisor to update the display name (custom_label) of a file.
 */
export async function renameClientFile(clientId: string, documentId: string, newLabel: string) {
    try {
        const supabase = await createClient();
        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) throw new Error("Unauthorized");

        const { data: client } = await supabase
            .from("client_data_vault")
            .select("id, advisor_id")
            .eq("id", clientId)
            .single();

        if (!client) throw new Error("Client not found");

        // Verify advisor ownership OR check if user is an underwriter
        const { data: userData } = await supabase
            .from("users")
            .select("role")
            .eq("id", advisorUser.id)
            .single();

        const isUnderwriter = userData?.role === "underwriting";

        if (!isUnderwriter) {
            const { data: advisorData } = await supabase
                .from("advisors")
                .select("id")
                .eq("user_id", advisorUser.id)
                .single();

            if (!advisorData || !(await hasClientAccess(supabase, advisorData.id, client.id, client.advisor_id))) {
                throw new Error("Access denied");
            }
        }

        const supabaseAdmin = createAdminClient();
        const { error } = await supabaseAdmin
            .from("user_documents")
            .update({ custom_label: newLabel })
            .eq("id", documentId);

        if (error) throw error;

        revalidatePath(`/advisor/dashboard/clients/${clientId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Exception in renameClientFile:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

/**
 * generateMagicLink
 * 
 * Allows an advisor to generate a one-time magic login link for a client.
 * Returns the secure action link which can be shared manually.
 */
export async function generateMagicLink(clientId: string) {
    try {
        const supabase = await createClient();
        
        // 1. Get authenticated advisor
        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) throw new Error("Unauthorized");

        // 2. Fetch client email and verify ownership
        const { data: client, error: clientError } = await supabase
            .from("client_data_vault")
            .select("client_email, advisor_id")
            .eq("id", clientId)
            .single();

        if (clientError || !client) throw new Error("Client not found");

        const { data: advisorData } = await supabase
            .from("advisors")
            .select("id")
            .eq("user_id", advisorUser.id)
            .single();

        if (!advisorData || !(await hasClientAccess(supabase, advisorData.id, clientId, client.advisor_id))) {
            throw new Error("Access denied: You do not have access to this client");
        }

        // 3. Generate Magic Link via Admin Client
        const supabaseAdmin = createAdminClient();
        const { data, error } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email: client.client_email,
        });

        if (error) throw new Error(`Failed to generate link: ${error.message}`);
        
        const hashed_token = data.properties.hashed_token;
        if (!hashed_token) throw new Error("Supabase did not return a hashed_token for the magic link.");

        // 4. Construct our PKCE-compatible /auth/confirm link
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://vault.creditbanc.io";
        const confirmUrl = `${siteUrl}/auth/confirm?token_hash=${hashed_token}&type=email&next=/dashboard`;

        return { success: true, link: confirmUrl };
    } catch (error: any) {
        console.error("Exception in generateMagicLink:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}
