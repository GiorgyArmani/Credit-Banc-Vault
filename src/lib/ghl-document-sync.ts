import { SupabaseClient } from "@supabase/supabase-js";

const BASE = "https://services.leadconnectorhq.com";

/**
 * DOC_CODE_TO_GHL_FIELD_MAP: Maps internal doc_code values to GHL custom field IDs
 */
const DOC_CODE_TO_GHL_FIELD_MAP: Record<string, { fieldId: string; fieldKey: string }> = {
    business_bank_statements: {
        fieldId: process.env.GHL_CF_BANK_STATEMENTS!,
        fieldKey: "contact.data_vault_files_bank_statements",
    },
    drivers_license: {
        fieldId: process.env.GHL_CF_DRIVERS_LICENSE!,
        fieldKey: "contact.data_vault_files_drivers_license",
    },
    voided_check: {
        fieldId: process.env.GHL_CF_VOIDED_CHECK!,
        fieldKey: "contact.data_vault_files_voided_check",
    },
    balance_sheets: {
        fieldId: process.env.GHL_CF_BALANCE_SHEETS!,
        fieldKey: "contact.data_vault_files_balance_sheets",
    },
    tax_returns: {
        fieldId: process.env.GHL_CF_TAX_RETURNS!,
        fieldKey: "contact.data_vault_files_tax_returns",
    },
    profit_loss: {
        fieldId: process.env.GHL_CF_CREDIT_PROFIT_LOSS!,
        fieldKey: "contact.data_vault_files_profit__loss",
    },
    funding_application: {
        fieldId: process.env.GHL_CF_FUNDING_APPLICATION!,
        fieldKey: "contact.data_vault_files_funding_application",
    },
    ar_report: {
        fieldId: process.env.GHL_CF_AR_REPORT!,
        fieldKey: "contact.data_vault_files_ar_report",
    },
    debt_schedule: {
        fieldId: process.env.GHL_CF_DEBT_SCHEDULE!,
        fieldKey: "contact.data_vault_files_debt_schedule",
    },
    pfs: {
        fieldId: process.env.GHL_CF_PFS!,
        fieldKey: "contact.data_vault_pfs",
    },
    asset_equipment_list: {
        fieldId: process.env.GHL_CF_ASSET_EQUIPMENT_LIST!,
        fieldKey: "contact.data_vault_asset__equipment_list",
    },
    "8821_4506": {
        fieldId: process.env.GHL_CF_8821_4506!,
        fieldKey: "contact.data_vault_8821__4506",
    },
    ein_ss4_letter: {
        fieldId: process.env.GHL_CF_EIN_SS4_LETTER!,
        fieldKey: "contact.data_vault_ein__ss4_letter",
    },
    w9: {
        fieldId: process.env.GHL_CF_W9!,
        fieldKey: "contact.data_vault_w9",
    },
    articles_of_incorporation: {
        fieldId: process.env.GHL_CF_ARTICLES_OF_INCORPORATION!,
        fieldKey: "contact.data_vault_articles_of_incorporation",
    },
    operating_agreement_bylaws: {
        fieldId: process.env.GHL_CF_OPERATING_AGREEMENT_BYLAWS!,
        fieldKey: "contact.data_vault_operating_agreement__bylaws",
    },
    lease_agreement: {
        fieldId: process.env.GHL_CF_LEASE_AGREEMENT!,
        fieldKey: "contact.data_vault_lease_agreement",
    },
    mortgage_statement: {
        fieldId: process.env.GHL_CF_MORTGAGE_STATEMENT!,
        fieldKey: "contact.data_vault_mortgage_statement",
    },
    credit_card_statements: {
        fieldId: process.env.GHL_CF_CREDIT_CARD_STATEMENTS!,
        fieldKey: "contact.data_vault_credit_card_statements",
    },
    loan_agreements: {
        fieldId: process.env.GHL_CF_LOAN_AGREEMENTS!,
        fieldKey: "contact.data_vault_loan_agreements",
    },
    payoff_letters: {
        fieldId: process.env.GHL_CF_PAYOFF_LETTERS!,
        fieldKey: "contact.data_vault_payoff_letters",
    },
    insurance_documents: {
        fieldId: process.env.GHL_CF_INSURANCE_DOCUMENTS!,
        fieldKey: "contact.data_vault_insurance_documents_gl_wc_auto_bop",
    },
    equipment_invoice: {
        fieldId: process.env.GHL_CF_EQUIPMENT_INVOICE!,
        fieldKey: "contact.data_vault_equipment_invoice",
    },
    misc_files: {
        fieldId: process.env.GHL_CF_MISC_FILES!,
        fieldKey: "contact.data_vault_misc_files",
    },
};

async function getContact(contactId: string, authToken: string) {
    const response = await fetch(`${BASE}/contacts/${contactId}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${authToken}`,
            Version: "2021-07-28",
        },
    });
    if (!response.ok) throw new Error(`Failed to fetch contact: ${response.statusText}`);
    return response.json();
}

async function updateContact(contactId: string, customFields: any[], authToken: string) {
    const response = await fetch(`${BASE}/contacts/${contactId}`, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${authToken}`,
            Version: "2021-07-28",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ customFields }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update contact: ${response.status} - ${errorText}`);
    }
    return response.json();
}

async function uploadFileToGHL(
    admin: SupabaseClient,
    contactId: string,
    locationId: string,
    fieldId: string,
    storagePath: string,
    fileName: string,
    authToken: string
): Promise<{ success: boolean; fileData?: any; error?: string }> {
    console.log(`🚀 Starting GHL upload for [${fileName}] to field [${fieldId}]...`);
    try {
        const { data: fileData, error: downloadError } = await admin.storage
            .from("user-documents")
            .download(storagePath);

        if (downloadError || !fileData) {
            console.error(`❌ Failed to download from Supabase:`, downloadError);
            return { success: false, error: `Failed to download file: ${downloadError?.message}` };
        }

        console.log(`📥 Downloaded from Supabase: ${fileData.size} bytes, type: ${fileData.type}`);

        const formData = new FormData();
        formData.append("id", contactId);
        formData.append("maxFiles", "15");

        // Use Blob directly with FormData for better compatibility
        formData.append(fieldId, fileData, fileName);

        console.log(`📤 Sending POST to GHL upload endpoint for contact ${contactId}...`);
        const ghlResponse = await fetch(`${BASE}/locations/${locationId}/customFields/upload`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${authToken}`,
                Version: "2021-07-28",
            },
            body: formData,
        });

        console.log(`📡 GHL Upload Response Status: ${ghlResponse.status} ${ghlResponse.statusText}`);

        if (!ghlResponse.ok) {
            const errorText = await ghlResponse.text();
            console.error(`❌ GHL API error response:`, errorText);
            return { success: false, error: `GHL API error: ${ghlResponse.status} - ${errorText}` };
        }

        const result = await ghlResponse.json();
        console.log(`✅ GHL Upload Successful:`, JSON.stringify(result));
        return { success: true, fileData: result };
    } catch (error: any) {
        console.error(`❌ Exception in uploadFileToGHL:`, error);
        return { success: false, error: error.message };
    }
}

async function updateGHLTags(contactId: string, docCode: string, authToken: string) {
    const requestedTag = `requested_${docCode}`;
    const submittedTag = `submitted_${docCode}`;

    await fetch(`${BASE}/contacts/${contactId}/tags`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}`, Version: "2021-07-28", "Content-Type": "application/json" },
        body: JSON.stringify({ tags: [requestedTag] }),
    });

    await fetch(`${BASE}/contacts/${contactId}/tags`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, Version: "2021-07-28", "Content-Type": "application/json" },
        body: JSON.stringify({ tags: [submittedTag] }),
    });
}

/**
 * ghlSyncDocument: Downloads a document from Supabase and uploads it to GHL
 */
export async function ghlSyncDocument(admin: SupabaseClient, documentId: string, userId: string, docCode: string) {
    const authToken = process.env.GHL_TOKEN;
    const locationId = process.env.GHL_LOCATION_ID;

    if (!authToken || !locationId) {
        console.warn("GHL_TOKEN or GHL_LOCATION_ID missing");
        return { success: false, error: "Missing config" };
    }

    const { data: doc } = await admin.from("user_documents").select("*").eq("id", documentId).single();
    const { data: vault } = await admin.from("client_data_vault").select("ghl_contact_id").eq("user_id", userId).maybeSingle();

    if (!doc || !vault?.ghl_contact_id) return { success: false, error: "Doc or Contact ID missing" };

    const mapping = DOC_CODE_TO_GHL_FIELD_MAP[docCode];
    if (!mapping) return { success: false, error: `No mapping for ${docCode}` };

    try {
        const contactData = await getContact(vault.ghl_contact_id, authToken);
        const existingField = (contactData.contact?.customFields || []).find((f: any) => f.id === mapping.fieldId);
        const existingValue = existingField ? existingField.value : {};

        const uploadResult = await uploadFileToGHL(admin, vault.ghl_contact_id, locationId, mapping.fieldId, doc.storage_path, doc.name, authToken);
        if (!uploadResult.success) return uploadResult;

        let newEntry = {};
        const meta = uploadResult.fileData?.meta?.[0];
        const url = Object.values(uploadResult.fileData?.uploadedFiles || {})[0] as string;
        if (url) {
            const uuid = url.split('/').pop()?.split('.')[0] || "file";
            newEntry = { [uuid]: { meta, url, documentId: uuid } };
        }

        const mergedValue = { ...(typeof existingValue === 'object' ? existingValue : {}), ...newEntry };
        await updateContact(vault.ghl_contact_id, [{ id: mapping.fieldId, value: mergedValue }], authToken);
        await updateGHLTags(vault.ghl_contact_id, docCode, authToken);

        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
