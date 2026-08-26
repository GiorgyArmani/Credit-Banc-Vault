export class SignWell {
    private apiKey: string;
    private baseUrl = 'https://www.signwell.com/api/v1';

    constructor() {
        this.apiKey = process.env.SIGNWELL_API_KEY || '';
    }

    private getHeaders() {
        return {
            'X-Api-Key': this.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
    }

    /**
     * Fetches template details to get placeholder information
     */
    async getTemplate(templateId: string): Promise<any> {
        const response = await fetch(`${this.baseUrl}/document_templates/${templateId}`, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch template ${templateId}: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Fetches document details to check status
     */
    async getDocument(documentId: string): Promise<any> {
        const response = await fetch(`${this.baseUrl}/documents/${documentId}`, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch document ${documentId}: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Creates a document from a template and returns the signing URL for the first recipient
     */
    async createDocument(params: {
        templateId: string;
        recipientEmail: string;
        recipientName: string;
        fields: Record<string, string>; // API ID -> Value
    }): Promise<{ signingUrl: string; embeddedSigningUrl?: string; documentId: string }> {
        if (!this.apiKey) {
            throw new Error('SIGNWELL_API_KEY is not configured');
        }

        console.log(`🔍 Fetching template details for: ${params.templateId}`);
        let placeholders: { id: string; name: string }[] = [{ id: "1", name: "Client" }]; // Default fallback
        try {
            const template = await this.getTemplate(params.templateId);

            if (template.placeholders && template.placeholders.length > 0) {
                placeholders = template.placeholders.map((p: any) => ({ id: p.id, name: p.name }));
                console.log(`✅ Found ${placeholders.length} placeholder(s):`, placeholders.map(p => `${p.id} (${p.name})`).join(', '));
            }
        } catch (error) {
            console.warn("⚠️ Could not fetch template details, falling back to default placeholder.", error);
        }

        // Use the correct endpoint for creating from a template
        const endpoint = `${this.baseUrl}/document_templates/documents/`;

        const templateFields = Object.entries(params.fields).map(([api_id, value]) => ({
            api_id,
            value: value || '' // Ensure empty strings for null/undefined
        }));

        const body: Record<string, unknown> = {
            template_id: params.templateId,
            test_mode: process.env.NODE_ENV === 'development',
            embedded_signing: true,
            // Assign the client recipient to every placeholder in the template
            recipients: placeholders.map(p => ({
                id: p.id,
                placeholder_name: p.name,
                email: params.recipientEmail,
                name: params.recipientName
            }))
        };

        // SignWell rejects `template_fields: []` outright ("invalid key values"),
        // so the key only goes on the wire when there is something to prefill.
        // The W-9 deliberately prefills nothing.
        if (templateFields.length > 0) {
            body.template_fields = templateFields;
        }

        console.log(`🚀 Sending Request to: ${endpoint}`);
        console.log('📝 Body:', JSON.stringify(body, null, 2));

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ SignWell API Error:', errorText);
            throw new Error(`SignWell API failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();

        // Extract the signing URL for the recipient
        const recipient = data.recipients?.find((r: any) => r.email === params.recipientEmail) || data.recipients?.[0];

        if (!recipient) {
            throw new Error('No recipients returned from SignWell');
        }

        return {
            signingUrl: recipient.signing_url,
            embeddedSigningUrl: recipient.embedded_signing_url,
            documentId: data.id
        };
    }

    /**
     * Gets the completed PDF for a signed document
     */
    async getCompletedPDF(params: {
        documentId: string;
        urlOnly?: boolean;
        auditPage?: boolean;
    }): Promise<{ url?: string; blob?: Blob }> {
        if (!this.apiKey) {
            throw new Error('SIGNWELL_API_KEY is not configured');
        }

        const urlOnly = params.urlOnly ?? true; // Default to URL only
        const auditPage = params.auditPage ?? true;

        const queryParams = new URLSearchParams({
            url_only: urlOnly.toString(),
            audit_page: auditPage.toString()
        });

        const endpoint = `${this.baseUrl}/documents/${params.documentId}/completed_pdf/?${queryParams}`;

        const response = await fetch(endpoint, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ SignWell PDF Error:', errorText);

            if (response.status === 404) {
                // Try to get document status to see if it's just not completed yet
                try {
                    const doc = await this.getDocument(params.documentId);
                    throw new Error(`Failed to get completed PDF: Document status is "${doc.status}". It must be "completed" to download the PDF.`);
                } catch (statusError: any) {
                    throw new Error(`Failed to get completed PDF: 404 Not Found (and could not verify status: ${statusError.message})`);
                }
            }

            throw new Error(`Failed to get completed PDF: ${response.status} ${response.statusText}`);
        }

        if (urlOnly) {
            const data = await response.json();
            return { url: data.file_url };
        } else {
            const blob = await response.blob();
            return { blob };
        }
    }
}

export const signWell = new SignWell();
