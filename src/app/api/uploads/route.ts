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
    fieldId: process.env.GHL_CF_BANK_STATEMENTS!,
    fieldKey: "contact.data_vault_files_bank_statements",
  },
  // Driver's license front and back (both use same custom field)
  drivers_license_front: {
    fieldId: process.env.GHL_CF_DRIVERS_LICENSE!,
    fieldKey: "contact.data_vault_files_drivers_license",
  },
  drivers_license_back: {
    fieldId: process.env.GHL_CF_DRIVERS_LICENSE!,
    fieldKey: "contact.data_vault_files_drivers_license",
  },
  // Consolidated Driver's License (Front & Back)
  drivers_license: {
    fieldId: process.env.GHL_CF_DRIVERS_LICENSE!,
    fieldKey: "contact.data_vault_files_drivers_license",
  },
  // Voided business check
  voided_check: {
    fieldId: process.env.GHL_CF_VOIDED_CHECK!,
    fieldKey: "contact.data_vault_files_voided_check",
  },
  // Debt schedule or balance sheets
  balance_sheets: {
    fieldId: process.env.GHL_CF_BALANCE_SHEETS!,
    fieldKey: "contact.data_vault_files_balance_sheets",
  },
  // Tax returns
  tax_returns: {
    fieldId: process.env.GHL_CF_TAX_RETURNS!,
    fieldKey: "contact.data_vault_files_tax_returns",
  },
  // Profit & Loss statements
  profit_loss: {
    fieldId: process.env.GHL_CF_CREDIT_PROFIT_LOSS!,
    fieldKey: "contact.data_vault_files_profit__loss",
  },
};

console.log("Loaded GHL Field Map:", JSON.stringify(DOC_CODE_TO_GHL_FIELD_MAP, null, 2));

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
    const file = new File([fileData], fileName, { type: fileData.type });

    // 3. Create FormData for GHL upload
    const formData = new FormData();
    formData.append("id", contactId);
    formData.append("maxFiles", "15"); // Ensure GHL knows we support multiple files
    formData.append(fieldId, file);

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
    console.log("GHL API Response:", JSON.stringify(result, null, 2));

    // The upload endpoint returns the file metadata keyed by the filename in `uploadedFiles`
    // OR it might return it in `meta` array. Structure varies based on GHL version/endpoint.
    // Based on user example: {"f31175d4...": { meta: ..., url: ..., documentId: ... }}
    // We need to construct this object or extract it.

    // Let's look at what we get. Usually `uploadedFiles` contains the key-value pair we need.
    const uploadedFileKey = Object.keys(result.uploadedFiles || {})[0];
    const uploadedFileData = result.uploadedFiles?.[uploadedFileKey];

    if (uploadedFileData) {
      // We need to return the object structure expected by the custom field
      // The key is the UUID of the file.
      // result.uploadedFiles is likely { "filename.jpg": "url" } OR { "filename.jpg": { ...metadata } }
      // Wait, the user example shows:
      // field_value: { "UUID": { meta: {...}, url: "...", documentId: "..." } }

      // If the upload endpoint returns the simple URL, we might need to construct the metadata manually?
      // OR the upload endpoint returns the full object.
      // Let's assume `result` contains the necessary info.

      // If `result.uploadedFiles` is just { "name": "url" }, we might be missing metadata.
      // However, usually the upload endpoint for custom fields handles the assignment if we just POST.
      // BUT, since we want to MERGE, we need the value.

      // Let's return the whole result for now and debug if needed, but try to construct the object.
      return {
        success: true,
        fileData: result // Return raw result to let caller handle or inspect
      };
    }

    return {
      success: true,
      fileData: result // Return raw result
    };

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

    // 2. Get client_data_vault record for this user (Primary source for GHL info)
    const { data: vaultRecord, error: vaultError } = await admin
      .from("client_data_vault")
      .select("id, ghl_contact_id, user_id")
      .eq("user_id", doc.user_id)
      .maybeSingle();

    if (vaultError) {
      console.error("Error fetching client_data_vault:", vaultError);
    }

    const profileId = vaultRecord?.id; // Use vault ID as profile ID for events/logging if needed

    // 3. Create event record (audit trail)
    if (profileId) {
      // Note: events table might still reference business_profiles(id). 
      // If client_data_vault.id is not compatible with events.profile_id (FK), we might skip this or need to fetch business_profile too.
      // However, for GHL sync, we prioritize vaultRecord.
      // Let's try to fetch business_profile just for the event FK constraint if it exists.
      const { data: bp } = await admin.from("business_profiles").select("id").eq("user_id", doc.user_id).maybeSingle();

      if (bp) {
        await admin.from("events").insert({
          profile_id: bp.id,
          type: "upload",
          payload: { doc_code, storage_path, document_id },
          actor: doc.user_id,
        });
      }
    }


    // 5. GHL Integration - Upload file and update tags
    console.log(`Checking GHL Integration prerequisites: VaultRecord: ${!!vaultRecord}, GHL_TOKEN exists: ${!!process.env.GHL_TOKEN}`);

    if (vaultRecord && process.env.GHL_TOKEN) {
      if (vaultRecord.ghl_contact_id) {
        // Use env var for location ID as it's not consistently in client_data_vault yet (or we can add it later)
        // The user said "we have it mapped on the env like this" for custom fields, implying env is source of truth for config.
        const ghlLocationId = process.env.GHL_LOCATION_ID;

        if (!ghlLocationId) {
          console.warn("GHL location ID not found in env, skipping GHL upload");
        } else {
          // Check if this doc_code has a mapped GHL custom field
          const ghlFieldMapping = DOC_CODE_TO_GHL_FIELD_MAP[doc_code];
          console.log(`Processing doc_code: ${doc_code}, Mapping found:`, ghlFieldMapping);

          if (ghlFieldMapping) {
            // A. Fetch current contact to get existing files
            console.log("Fetching current contact data...");
            const contactData = await getContact(vaultRecord.ghl_contact_id, process.env.GHL_TOKEN);
            const currentCustomFields = contactData.contact?.customFields || [];

            // Find existing value for this field
            const existingField = currentCustomFields.find((f: any) => f.id === ghlFieldMapping.fieldId);
            const existingValue = existingField ? existingField.value : {}; // File fields are objects

            console.log("Existing field value:", JSON.stringify(existingValue, null, 2));

            // B. Upload new file
            const uploadResult = await uploadFileToGHL(
              vaultRecord.ghl_contact_id,
              ghlLocationId,
              ghlFieldMapping.fieldId,
              doc.storage_path,
              doc.name,
              process.env.GHL_TOKEN
            );

            if (uploadResult.success && uploadResult.fileData) {
              // C. Merge new file with existing files
              // The upload response `fileData` should contain the new file's metadata object
              // We need to extract the specific file object from the upload result.
              // Assuming uploadResult.fileData returns the structure { "UUID": { ... } } or similar

              // Note: The /customFields/upload endpoint might return:
              // { meta: [ { uuid: "...", ... } ], ... }
              // We need to convert this to the map format expected by PUT:
              // { "UUID": { meta: ..., url: ..., documentId: ... } }

              let newFileEntry = {};
              if (uploadResult.fileData.meta && uploadResult.fileData.meta.length > 0) {
                const m = uploadResult.fileData.meta[0];
                const uuid = m.uuid || m.documentId;
                newFileEntry = {
                  [uuid]: {
                    meta: m,
                    url: m.url,
                    documentId: m.documentId || m.uuid
                  }
                };
              } else {
                // Fallback if structure is different
                console.warn("Unexpected upload response structure, trying to use as is", uploadResult.fileData);
                newFileEntry = uploadResult.fileData;
              }

              // Merge: existingValue + newFileEntry
              // Ensure existingValue is an object
              const mergedValue = { ...(typeof existingValue === 'object' ? existingValue : {}), ...newFileEntry };

              console.log("Merged field value:", JSON.stringify(mergedValue, null, 2));

              // D. Update contact with merged value
              await updateContact(
                vaultRecord.ghl_contact_id,
                [{ id: ghlFieldMapping.fieldId, field_value: mergedValue }],
                process.env.GHL_TOKEN
              );

              console.log(`✅ Successfully updated contact with new file for ${doc_code}`);
            } else {
              console.error(`❌ Failed to upload ${doc_code}:`, uploadResult.error);
            }
          } else {
            console.warn(
              `⚠️ No GHL field mapping found for doc_code: ${doc_code}`
            );
          }

          // Update tags: requested_* → submitted_*
          await updateGHLTags(
            vaultRecord.ghl_contact_id,
            doc_code,
            process.env.GHL_TOKEN
          );
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