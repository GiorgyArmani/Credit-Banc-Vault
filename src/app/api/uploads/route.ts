import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

/**
 * DOC_CODE_TO_GHL_FIELD_MAP: Maps internal doc_code values to GHL custom field IDs
 * These custom fields must be created in GHL beforehand as FILE_UPLOAD type
 */
const DOC_CODE_TO_GHL_FIELD_MAP: Record<string, { fieldId: string; fieldKey: string }> = {
  // Bank statements (last 6 months)
  bank_statements_6mo: {
    fieldId: "gdpBhJJ5RKtLYbWlFXhI",
    fieldKey: "contact.data_vault_files_bank_statements",
  },
  // Driver's license front and back (both use same custom field)
  drivers_license_front: {
    fieldId: "XMXkevs2VI8IOLIeEGhp",
    fieldKey: "contact.data_vault_files_drivers_license",
  },
  drivers_license_back: {
    fieldId: "XMXkevs2VI8IOLIeEGhp",
    fieldKey: "contact.data_vault_files_drivers_license",
  },
  // Voided business check
  voided_check: {
    fieldId: "QXOn6kwwOAkJk7YtD8ls",
    fieldKey: "contact.data_vault_files_voided_check",
  },
  // Debt schedule or balance sheets
  debt_schedule: {
    fieldId: "XawiUQdnYleZz5eqHfuH",
    fieldKey: "contact.data_vault_files_balance_sheets",
  },
  // Tax returns
  tax_returns: {
    fieldId: "7eGo8ubBbbP5e3T2gsbv",
    fieldKey: "contact.data_vault_files_tax_returns",
  },
  // Profit & Loss statements
  profit_loss: {
    fieldId: "W9Q4eJJ2uPoW7RAW2kZB",
    fieldKey: "contact.data_vault_files_profit__loss",
  },
};

/**
 * uploadFileToGHL: Downloads file from Supabase and uploads it to GHL custom field
 * 
 * @param contactId - GHL contact ID
 * @param locationId - GHL location ID
 * @param fieldId - Custom field ID in GHL
 * @param storagePath - Path to file in Supabase storage
 * @param fileName - Original file name
 * @param authToken - GHL API authorization token
 */
async function uploadFileToGHL(
  contactId: string,
  locationId: string,
  fieldId: string,
  storagePath: string,
  fileName: string,
  authToken: string
): Promise<{ success: boolean; url?: string; error?: string }> {
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
    const file = new File([fileData], fileName, { type: fileData.type });

    // 3. Create FormData for GHL upload
    const formData = new FormData();
    formData.append("id", contactId);
    formData.append("maxFiles", "15");
    formData.append(fileName, file);

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

    if (!ghlResponse.ok) {
      const errorText = await ghlResponse.text();
      return {
        success: false,
        error: `GHL API error: ${ghlResponse.status} - ${errorText}`,
      };
    }

    const result = await ghlResponse.json();
    const uploadedUrl = result.uploadedFiles?.[fileName] || null;

    return { success: true, url: uploadedUrl };
  } catch (error: any) {
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
  try {
    const requestedTag = `requested_${docCode}`;
    const submittedTag = `submitted_${docCode}`;

    // Remove requested tag
    await fetch(
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
    ).catch((err) => console.warn("Failed to remove requested tag:", err));

    // Add submitted tag
    await fetch(
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
    ).catch((err) => console.warn("Failed to add submitted tag:", err));
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
    const body = await req.json();
    const { document_id, storage_path, doc_code } = body;

    if (!document_id || !storage_path || !doc_code) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // 1. Get document details from database
    const { data: doc, error: docError } = await admin
      .from("user_documents")
      .select("user_id, name, storage_path")
      .eq("id", document_id)
      .single();

    if (docError || !doc) {
      console.error("Document not found:", docError);
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // 2. Get business profile for this user
    const { data: profile, error: profileError } = await admin
      .from("business_profiles")
      .select("id")
      .eq("user_id", doc.user_id)
      .maybeSingle();

    if (profileError) {
      console.error("Error fetching profile:", profileError);
    }

    const profileId = profile?.id;

    // 3. Create event record if we have a profile
    if (profileId) {
      await admin.from("events").insert({
        profile_id: profileId,
        type: "upload",
        payload: { doc_code, storage_path, document_id },
        actor: doc.user_id,
      });
    }

    // 4. Send webhook notification to n8n (if configured)
    if (process.env.N8N_WEBHOOK_UPLOAD && profileId) {
      fetch(process.env.N8N_WEBHOOK_UPLOAD, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile_id: profileId,
          user_id: doc.user_id,
          doc_code,
          document_id,
        }),
      }).catch(() => {});
    }

    // 5. GHL Integration - Upload file and update tags
    if (profileId && process.env.GHL_TOKEN) {
      const { data: integ } = await admin
        .from("integrations")
        .select("ghl_contact_id, ghl_location_id")
        .eq("profile_id", profileId)
        .maybeSingle();

      if (integ?.ghl_contact_id) {
        const ghlLocationId = integ.ghl_location_id || process.env.GHL_LOCATION_ID;

        if (!ghlLocationId) {
          console.warn("GHL location ID not found, skipping GHL upload");
        } else {
          // Check if this doc_code has a mapped GHL custom field
          const ghlFieldMapping = DOC_CODE_TO_GHL_FIELD_MAP[doc_code];

          if (ghlFieldMapping) {
            // Upload file to GHL custom field
            const uploadResult = await uploadFileToGHL(
              integ.ghl_contact_id,
              ghlLocationId,
              ghlFieldMapping.fieldId,
              doc.storage_path,
              doc.name,
              process.env.GHL_TOKEN
            );

            if (uploadResult.success) {
              console.log(
                `✅ Successfully uploaded ${doc_code} to GHL field ${ghlFieldMapping.fieldKey}`
              );
            } else {
              console.error(
                `❌ Failed to upload ${doc_code} to GHL:`,
                uploadResult.error
              );
            }
          } else {
            console.warn(
              `⚠️ No GHL field mapping found for doc_code: ${doc_code}`
            );
          }

          // Update tags: requested_* → submitted_*
          await updateGHLTags(
            integ.ghl_contact_id,
            doc_code,
            process.env.GHL_TOKEN
          );
        }
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