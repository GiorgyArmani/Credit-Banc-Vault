import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ghlAddTags } from "@/lib/ghl-api";
import { send_advisor_vault_submission_notification } from "@/lib/email";
import { updateLoanStatus } from "@/app/actions/pipeline";

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 1. Get client's GHL contact ID and Advisor ID
        const { data: clientData, error: fetchError } = await supabase
            .from("client_data_vault")
            .select(`
                id, 
                ghl_contact_id, 
                advisor_id, 
                client_name, 
                company_name,
                advisors (
                    id, 
                    first_name,
                    last_name,
                    email,
                    user_id
                )
            `)
            .eq("user_id", user.id)
            .single();

        if (fetchError || !clientData) {
            console.error("Error fetching client data:", fetchError);
            return NextResponse.json(
                { error: "Client data not found" },
                { status: 404 }
            );
        }

        if (!clientData.ghl_contact_id) {
            console.warn("No GHL Contact ID found for user", user.id);
        } else {
            // 2. Add tag in GHL
            await ghlAddTags(clientData.ghl_contact_id, ["vault_submitted"]);
        }

        // 3. Mark as submitted in local client_data_vault
        const { error: updateError } = await supabase
            .from("client_data_vault")
            .update({
                data_vault_submitted_at: new Date().toISOString(),
            })
            .eq("id", clientData.id);

        if (updateError) {
            throw updateError;
        }

        // 4. Create or Update record in public.submissions for Underwriting using upsert
        const { error: submissionError } = await supabase
            .from("submissions")
            .upsert({
                user_id: user.id,
                advisor_id: clientData.advisor_id,
                status: 'submitted',
                submitted_at: new Date().toISOString()
            }, { onConflict: 'user_id' });

        if (submissionError) {
            console.error("Error creating submission record:", submissionError);
        }

        // 5. Update Pipeline Status to Under Review.
        //    Client-triggered, so it must go through the service role — the
        //    caller is role='free' and loan_status_history writes are staff-only.
        try {
            await updateLoanStatus(clientData.id, 'under_review', 'Vault submitted by client', {
                useServiceRole: true,
            });
            console.log(`✅ Pipeline status updated to "under_review" for client: ${clientData.id}`);
        } catch (pipeline_error) {
            console.error("⚠️ Error updating pipeline status (non-fatal):", pipeline_error);
        }

        // 6. Notify Advisor
        if (clientData.advisor_id && clientData.advisors) {
            const advisor: any = clientData.advisors;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";

            // A. In-app notification for advisor if they have a user_id.
            //    Service role: the actor here is the CLIENT, and notification
            //    inserts are staff-only under RLS (every other notification
            //    write in the app goes through the admin client too).
            if (advisor.user_id) {
                await createAdminClient().from("in_app_notifications").insert({
                    user_id: advisor.user_id,
                    client_id: clientData.id,
                    title: "New Vault Submission",
                    message: `${clientData.client_name} (${clientData.company_name}) has submitted their vault for review.`,
                });
            }

            // B. Email notification for advisor (CC followers)
            if (advisor.email) {
                try {
                    const { getFollowerEmailsForClient } = await import("@/lib/followers");
                    const follower_emails = await getFollowerEmailsForClient(supabase, clientData.id);

                    await send_advisor_vault_submission_notification({
                        advisor_name: `${advisor.first_name} ${advisor.last_name}`,
                        advisor_email: advisor.email,
                        advisor_cc_emails: follower_emails,
                        client_name: clientData.client_name,
                        company_name: clientData.company_name,
                        submission_date: new Date().toLocaleDateString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                        }),
                        login_url: `${appUrl}/auth/login`,
                    });
                } catch (emailError) {
                    console.error("Error sending advisor submission email:", emailError);
                }
            }
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("Error submitting vault:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
