import { NextResponse } from "next/server";
import { createClient as createBrowserClient } from "@/lib/supabase/server";
import { syncOutstandingDocuments } from "@/lib/outstanding-documents";
import { SupabaseClient } from "@supabase/supabase-js";
import { send_new_document_uploaded_notification } from "@/lib/email";

/**
 * DOC_CODE_TO_GHL_FIELD_MAP: Maps internal doc_code values to GHL custom field IDs
 * These custom fields must be created in GHL beforehand as FILE_UPLOAD type
 */
const DOC_CODE_TO_GHL_FIELD_MAP: Record<string, { fieldId: string; fieldKey: string }> = {
  // Bank statements (last 6 months)
  business_bank_statements: {
    fieldId: process.env.GHL_CF_BANK_STATEMENTS || "gdpBhJJ5RKtLYbWlFXhI",
    fieldKey: "contact.data_vault_files_bank_statements",
  },
  // Driver's license front and back (both use same custom field)
  drivers_license_front: {
    fieldId: process.env.GHL_CF_DRIVERS_LICENSE || "XMXkevs2VI8IOLIeEGhp",
    fieldKey: "contact.data_vault_files_drivers_license",
  },
  drivers_license_back: {
    fieldId: process.env.GHL_CF_DRIVERS_LICENSE || "XMXkevs2VI8IOLIeEGhp",
    fieldKey: "contact.data_vault_files_drivers_license",
  },
  // Consolidated Driver's License (Front & Back)
  drivers_license: {
    fieldId: process.env.GHL_CF_DRIVERS_LICENSE || "XMXkevs2VI8IOLIeEGhp",
    fieldKey: "contact.data_vault_files_drivers_license",
  },
  // Voided business check
  voided_check: {
    fieldId: process.env.GHL_CF_VOIDED_CHECK || "QXOn6kwwOAkJk7YtD8ls",
    fieldKey: "contact.data_vault_files_voided_check",
  },
  // Debt schedule or balance sheets
  balance_sheets: {
    fieldId: process.env.GHL_CF_BALANCE_SHEETS || "XawiUQdnYleZz5eqHfuH",
    fieldKey: "contact.data_vault_files_balance_sheets",
  },
  // Tax returns
  tax_returns: {
    fieldId: process.env.GHL_CF_TAX_RETURNS || "7eGo8ubBbbP5e3T2gsbv",
    fieldKey: "contact.data_vault_files_tax_returns",
  },
  // Profit & Loss statements
  profit_loss: {
    fieldId: process.env.GHL_CF_CREDIT_PROFIT_LOSS || "W9Q4eJJ2uPoW7RAW2kZB",
    fieldKey: "contact.data_vault_files_profit__loss",
  },
  // Funding Application
  funding_application: {
    fieldId: process.env.GHL_CF_FUNDING_APPLICATION || "iSvQIeBgIsbtHTPYmHiv",
    fieldKey: "contact.data_vault_files_funding_application",
  },
  // A/R Report
  ar_report: {
    fieldId: process.env.GHL_CF_AR_REPORT || "10ciAtMopHUBGL40iXbu",
    fieldKey: "contact.data_vault_files_ar_report",
  },
  // Debt Schedule
  debt_schedule: {
    fieldId: process.env.GHL_CF_DEBT_SCHEDULE || "xY2NMYDxjp5ZzMo1SRCj",
    fieldKey: "contact.data_vault_files_debt_schedule",
  },

  // --- New Dynamic Documents ---

  // PFS (Personal Financial Statement)
  pfs: {
    fieldId: process.env.GHL_CF_PFS || "5EMH8vr1RTnvF9ehzBtM",
    fieldKey: "contact.data_vault_pfs",
  },
  // Asset / Equipment List
  asset_equipment_list: {
    fieldId: process.env.GHL_CF_ASSET_EQUIPMENT_LIST || "eAAAUWVkTsec0nicpqnr",
    fieldKey: "contact.data_vault_asset__equipment_list",
  },
  // 8821 / 4506
  "8821_4506": {
    fieldId: process.env.GHL_CF_8821_4506 || "zduVkOHJAxMnh94hIDgS",
    fieldKey: "contact.data_vault_8821__4506",
  },
  // EIN / SS4 Letter
  ein_ss4_letter: {
    fieldId: process.env.GHL_CF_EIN_SS4_LETTER || "NOxQLvYlCzFXc9CO8Spn",
    fieldKey: "contact.data_vault_ein__ss4_letter",
  },
  // W9
  w9: {
    fieldId: process.env.GHL_CF_W9 || "flt5gHfpthvvC2U7evWD",
    fieldKey: "contact.data_vault_w9",
  },
  // Articles of Incorporation
  articles_of_incorporation: {
    fieldId: process.env.GHL_CF_ARTICLES_OF_INCORPORATION || "bebHZhDSfmmTKht5YJtK",
    fieldKey: "contact.data_vault_articles_of_incorporation",
  },
  // Operating Agreement / Bylaws
  operating_agreement_bylaws: {
    fieldId: process.env.GHL_CF_OPERATING_AGREEMENT_BYLAWS || "VSB2PJKDYNTOCC2RLOk9",
    fieldKey: "contact.data_vault_operating_agreement__bylaws",
  },
  // Lease Agreement
  lease_agreement: {
    fieldId: process.env.GHL_CF_LEASE_AGREEMENT || "9yfjmDHm0IHatEGAwPjp",
    fieldKey: "contact.data_vault_lease_agreement",
  },
  // Mortgage Statement
  mortgage_statement: {
    fieldId: process.env.GHL_CF_MORTGAGE_STATEMENT || "qdN57NE4yqLZPxV4Qs54",
    fieldKey: "contact.data_vault_mortgage_statement",
  },
  // Credit Card Statements
  credit_card_statements: {
    fieldId: process.env.GHL_CF_CREDIT_CARD_STATEMENTS || "xws781Qaq928WrjajFFj",
    fieldKey: "contact.data_vault_credit_card_statements",
  },
  // Loan Agreements
  loan_agreements: {
    fieldId: process.env.GHL_CF_LOAN_AGREEMENTS || "5Ujw7Kj3GbUhO0InRm1O",
    fieldKey: "contact.data_vault_loan_agreements",
  },
  // Payoff letters
  payoff_letters: {
    fieldId: process.env.GHL_CF_PAYOFF_LETTERS || "w0EdmjnW2eHNUuh2baZf",
    fieldKey: "contact.data_vault_payoff_letters",
  },
  // Insurance Documents (GL, WC, Auto, BOP)
  insurance_documents: {
    fieldId: process.env.GHL_CF_INSURANCE_DOCUMENTS || "q1VtGSoxBdLT6nRC4RlB",
    fieldKey: "contact.data_vault_insurance_documents_gl_wc_auto_bop",
  },
  // Equipment Invoice
  equipment_invoice: {
    fieldId: process.env.GHL_CF_EQUIPMENT_INVOICE || "c9qknvRkZEO8PxOrb46T",
    fieldKey: "contact.data_vault_equipment_invoice",
  },
  // Misc. Files
  misc_files: {
    fieldId: process.env.GHL_CF_MISC_FILES || "ZMU3gUg4gD7Lhspt5K80",
    fieldKey: "contact.data_vault_misc_files",
  },
  // MyScoreIQ Credit Report
  myscoreiq: {
    fieldId: process.env.GHL_CF_MYSCOREIQ || "Q6okQxXoqgxswNVWf2DY",
    fieldKey: "contact.data_vault_myscoreiq_credit_report",
  },
};

/**
 * getContact: Fetches contact details from GHL
 */
async function getContact(contactId: string, authToken: string) {
  const response = await fetch(
    `https://services.leadconnectorhq.com/contacts/${contactId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
        Version: "2021-07-28",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch contact: ${response.statusText}`);
  }

  return response.json();
}

/**
 * updateContact: Updates contact custom fields in GHL
 */
async function updateContact(contactId: string, customFields: any[], authToken: string) {
  const response = await fetch(
    `https://services.leadconnectorhq.com/contacts/${contactId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${authToken}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ customFields }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update contact: ${response.status} - ${errorText}`);
  }

  return response.json();
}

/**
 * uploadFileToGHL: Downloads file from Supabase and uploads it to GHL custom field
 * Returns the full file metadata needed for the custom field value
 */
async function uploadFileToGHL(
  admin: SupabaseClient,
  contactId: string,
  locationId: string,
  fieldId: string,
  storagePath: string,
  fileName: string,
  authToken: string
): Promise<{ success: boolean; fileData?: any; error?: string }> {
  console.log(`Starting GHL upload for ${fileName} to field ${fieldId}`);
  try {
    // 1. Download file from Supabase storage
    const { data: fileData, error: downloadError } = await admin.storage
      .from("user-documents")
      .download(storagePath);

    if (downloadError || !fileData) {
      return {
        success: false,
        error: `Failed to download file from Supabase: ${downloadError?.message}`,
      };
    }

    // 2. Convert Blob to File object
    console.log(`Downloaded file size: ${fileData.size}, type: ${fileData.type}`);
    const file = new File([fileData], fileName, { type: fileData.type });

    // 3. Create FormData for GHL upload
    const formData = new FormData();
    formData.append("id", contactId);
    formData.append("maxFiles", "15"); // Ensure GHL knows we support multiple files
    formData.append(fieldId, file);

    console.log("Sending request to GHL...");
    // 4. Upload to GHL
    const ghlResponse = await fetch(
      `https://services.leadconnectorhq.com/locations/${locationId}/customFields/upload`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          Version: "2021-07-28",
        },
        body: formData,
      }
    );

    console.log(`GHL Response Status: ${ghlResponse.status}`);

    if (!ghlResponse.ok) {
      const errorText = await ghlResponse.text();
      console.error(`GHL Error Response: ${errorText}`);
      return {
        success: false,
        error: `GHL API error: ${ghlResponse.status} - ${errorText}`,
      };
    }

    const result = await ghlResponse.json();
    console.log("GHL API Response:", JSON.stringify(result, null, 2));

    return {
      success: true,
      fileData: result
    };

  } catch (error: any) {
    console.error("Error in uploadFileToGHL:", error);
    return { success: false, error: error.message };
  }
}

/**
 * updateGHLTags: Updates contact tags in GHL
 * Removes "requested_{docCode}" tag and adds "submitted_{docCode}" tag
 */
async function updateGHLTags(
  contactId: string,
  docCode: string,
  authToken: string
): Promise<void> {
  console.log(`Updating GHL tags for contact ${contactId}, docCode: ${docCode}`);
  try {
    const requestedTag = `requested_${docCode}`;
    const submittedTag = `submitted_${docCode}`;

    // Remove requested tag
    console.log(`Removing tag: ${requestedTag}`);
    const deleteResp = await fetch(
      `https://services.leadconnectorhq.com/contacts/${contactId}/tags`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${authToken}`,
          Version: "2021-07-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tags: [requestedTag] }),
      }
    );

    if (!deleteResp.ok) {
      const errText = await deleteResp.text();
      console.warn(`Failed to remove tag ${requestedTag}: ${deleteResp.status} - ${errText}`);
    } else {
      console.log(`Successfully removed tag: ${requestedTag}`);
    }

    // Add submitted tag
    console.log(`Adding tag: ${submittedTag}`);
    const addResp = await fetch(
      `https://services.leadconnectorhq.com/contacts/${contactId}/tags`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          Version: "2021-07-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tags: [submittedTag] }),
      }
    );

    if (!addResp.ok) {
      const errText = await addResp.text();
      console.error(`Failed to add tag ${submittedTag}: ${addResp.status} - ${errText}`);
    } else {
      console.log(`Successfully added tag: ${submittedTag}`);
    }

  } catch (error) {
    console.error("Error updating GHL tags:", error);
  }
}

/**
 * POST /api/uploads
 * 
 * This endpoint is called AFTER a document has been uploaded to Supabase
 * It handles:
 * 1. Creating event records for audit trail
 * 2. Uploading the file to GHL custom fields
 * 3. Updating GHL tags (requested_* → submitted_*)
 * 4. Sending webhook notifications
 */
export async function POST(req: Request) {
  try {
    const supabase = await createBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { createClient: createAdminClient } = await import("@supabase/supabase-js");
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const body = await req.json();
    const { document_id, storage_path, doc_code } = body;

    if (!document_id || !storage_path || !doc_code) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // 1. Get document details from database and verify ownership
    const { data: doc, error: docError } = await admin
      .from("user_documents")
      .select("user_id, name, storage_path")
      .eq("id", document_id)
      .single();

    if (docError || !doc) {
      console.error("Document not found:", docError);
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Security check: Ensure the document belongs to the authenticated user
    if (doc.user_id !== user.id) {
      console.error(`❌ Security Violation: User ${user.id} attempted to process document ${document_id} belonging to ${doc.user_id}`);
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 2. Get client_data_vault record for this user (Primary source for GHL info and Advisor info)
    const { data: vaultRecord, error: vaultError } = await admin
      .from("client_data_vault")
      .select(`
        id, 
        ghl_contact_id, 
        user_id, 
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
      .eq("user_id", doc.user_id)
      .maybeSingle();

    if (vaultError) {
      console.error("Error fetching client_data_vault:", vaultError);
    }

    const profileId = vaultRecord?.id;

    // 3. Advance pipeline to documents_received on the first upload for this
    //    client. updateLoanStatus is idempotent (it skips redundant consecutive
    //    entries), so calling it on every upload is safe — only the first one
    //    actually inserts a row.
    if (profileId) {
      const { data: latest } = await admin
        .from("loan_status_history")
        .select("status")
        .eq("client_vault_id", profileId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latest?.status !== "documents_received" && latest?.status !== "under_review"
          && latest?.status !== "lender_matched" && latest?.status !== "funded") {
        await admin.from("loan_status_history").insert({
          client_vault_id: profileId,
          status: "documents_received",
          changed_by: doc.user_id,
          changed_by_role: "client",
          note: `Document uploaded (${doc_code})`,
        });
      }
    }

    // 4. Create event record (audit trail)
    if (profileId) {
      const { data: bp } = await admin
        .from("business_profiles")
        .select("id")
        .eq("client_vault_id", vaultRecord!.id)
        .eq("is_primary", true)
        .maybeSingle();

      if (bp) {
        await admin.from("events").insert({
          profile_id: bp.id,
          type: "upload",
          payload: { doc_code, storage_path, document_id },
          actor: doc.user_id,
        });
      }
    }

    // 4. Notify Advisor
    if (vaultRecord && vaultRecord.advisors) {
      const advisor: any = vaultRecord.advisors;
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";

      // A. Get Document Label
      let docLabel = doc_code;
      try {
        const { data: reqDoc } = await admin
          .from("required_documents")
          .select("label")
          .eq("code", doc_code)
          .maybeSingle();
        if (reqDoc?.label) docLabel = reqDoc.label;
      } catch (e) {}

      // B. In-app notification for advisor
      if (advisor.user_id) {
        try {
          await admin.from("in_app_notifications").insert({
            user_id: advisor.user_id,
            client_id: vaultRecord.id,
            title: "New Document Uploaded",
            message: `${vaultRecord.client_name} uploaded: ${docLabel}`,
          });
        } catch (notifierr) {
          console.error("Error creating in-app notification:", notifierr);
        }
      }

      // C. Email notification for advisor (CC followers)
      if (advisor.email) {
        try {
          const { getFollowerEmailsForClient } = await import("@/lib/followers");
          const follower_emails = await getFollowerEmailsForClient(admin, vaultRecord.id);

          await send_new_document_uploaded_notification({
            advisor_name: `${advisor.first_name} ${advisor.last_name}`,
            advisor_email: advisor.email,
            advisor_cc_emails: follower_emails,
            client_name: vaultRecord.client_name,
            document_name: doc.name,
            document_category: docLabel,
            upload_date: new Date().toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            }),
            login_url: `${appUrl}/auth/login`,
          });
        } catch (emailError) {
          console.error("Error sending document upload email:", emailError);
        }
      }
    }

    // 5. GHL Integration - Upload file and update tags
    console.log(`Checking GHL Integration prerequisites: VaultRecord: ${!!vaultRecord}, GHL_TOKEN exists: ${!!process.env.GHL_TOKEN}`);

    if (vaultRecord && process.env.GHL_TOKEN) {
      if (vaultRecord.ghl_contact_id) {
        try {
          const { ghlSyncDocument } = await import("@/lib/ghl-document-sync");
          // Note: ghlSyncDocument handles checking mapping, uploading, and tagging
          const syncResult = await ghlSyncDocument(
            admin,
            document_id,
            user.id,
            doc_code
          );

          if (syncResult.success) {
            console.log(`✅ Successfully synced ${doc_code} to GHL via shared utility`);
          } else {
            console.warn(`⚠️ GHL Sync failed or skipped for ${doc_code}:`, syncResult.error);
          }
          
          try {
            await syncOutstandingDocuments(doc.user_id, vaultRecord.ghl_contact_id, process.env.GHL_TOKEN);
            console.log(`✅ Synced outstanding docs after upload`);
          } catch (syncOutstError) {
            console.error("❌ Error syncing outstanding documents:", syncOutstError);
          }
        } catch (syncError) {
          console.error("❌ Error importing/calling ghlSyncDocument:", syncError);
        }
      } else {
        console.warn("No GHL Contact ID found in client_data_vault for user", doc.user_id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error in /api/uploads:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}