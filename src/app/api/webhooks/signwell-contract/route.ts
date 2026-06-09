import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { signWell } from '@/lib/signwell';
import { releaseSpeedFormDocs } from '@/lib/speed-form';

// Cliente de Supabase con service role para operaciones del servidor
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Token de seguridad para validar que el webhook viene de Zapier
const WEBHOOK_SECRET = process.env.SIGNWELL_WEBHOOK_SECRET || '';

/**
 * POST /api/webhooks/signwell-contract
 * Recibe webhooks de Zapier cuando un contrato se completa en SignWell
 */
export async function POST(request: NextRequest) {
    console.log('🔔 Webhook recibido - Iniciando procesamiento');

    try {
        // 1. Parsear el body JSON
        const payload = await request.json();

        console.log('📦 Payload recibido:', {
            has_secret: !!payload.secret,
            client_email: payload.client_email,
            contract_id: payload.contract_id,
            completed_at: payload.completed_at
        });

        // 2. Validar el token de seguridad
        if (!WEBHOOK_SECRET) {
            console.error('❌ Error de configuración: SIGNWELL_WEBHOOK_SECRET no está definido');
            return NextResponse.json(
                { success: false, error: 'Configuration Error' },
                { status: 500 }
            );
        }

        if (!payload.secret || payload.secret !== WEBHOOK_SECRET) {
            console.error('❌ Token de seguridad inválido');
            return NextResponse.json(
                {
                    success: false,
                    error: 'Unauthorized - Invalid secret token'
                },
                { status: 401 }
            );
        }

        // 3. Validar que tenemos el email del cliente
        const client_email = payload.client_email || payload.email;

        if (!client_email) {
            console.error('❌ Email del cliente no proporcionado');
            return NextResponse.json(
                {
                    success: false,
                    error: 'Bad Request - client_email is required',
                    received_payload: payload
                },
                { status: 400 }
            );
        }

        console.log('🔍 Buscando cliente con email:', client_email);

        // 3.5. Multi-business contract resolution. Prefer matching by the
        //      Signwell document_id against funding_deals.signwell_envelope_id
        //      so a signed contract gets stamped on the correct business when
        //      a client has multiple businesses. Falls back to the legacy
        //      "lookup by email" behavior if no funding_deal matches (covers
        //      the original onboarding contract which lives on client_data_vault).
        const signwellDocumentId: string | null = payload.document_id || payload.contract_id || null;
        let matchedFundingDealId: string | null = null;
        let matchedBusinessProfileId: string | null = null;
        if (signwellDocumentId) {
            const { data: deal } = await supabase
                .from('funding_deals')
                .select('id, business_profile_id, contract_completed')
                .eq('signwell_envelope_id', signwellDocumentId)
                .maybeSingle();
            if (deal) {
                matchedFundingDealId = deal.id;
                matchedBusinessProfileId = deal.business_profile_id;
                // Mark the funding_deal completed up front; the per-business
                // contract status is now the source of truth, while the
                // client_data_vault flag below covers the legacy single-deal
                // dashboard banner. Idempotent (skip if already completed).
                if (!deal.contract_completed) {
                    const { error: dealUpdErr } = await supabase
                        .from('funding_deals')
                        .update({
                            contract_completed: true,
                            contract_completed_at: parse_date_to_iso(payload.completed_at),
                        })
                        .eq('id', deal.id);
                    if (dealUpdErr) console.error('⚠️ funding_deal complete update failed:', dealUpdErr.message);
                }
            }
        }

        // 4. Buscar el registro del cliente en la base de datos
        const { data: client_data, error: fetch_error } = await supabase
            .from('client_data_vault')
            .select('id, user_id, client_email, client_name, contract_completed')
            .eq('client_email', client_email)
            .maybeSingle();

        if (fetch_error) {
            console.error('❌ Error buscando cliente:', fetch_error);
            return NextResponse.json(
                {
                    success: false,
                    error: 'Database error while fetching client',
                    details: fetch_error.message
                },
                { status: 500 }
            );
        }

        if (!client_data) {
            console.error('❌ Cliente no encontrado con email:', client_email);
            return NextResponse.json(
                {
                    success: false,
                    error: 'Client not found with provided email',
                    client_email,
                    hint: 'Verifica que el email en SignWell coincida con el email en client_data_vault'
                },
                { status: 404 }
            );
        }

        console.log('✅ Cliente encontrado:', {
            id: client_data.id,
            name: client_data.client_name,
            email: client_data.client_email
        });

        // 5. Verificar si el contrato ya estaba completado
        if (client_data.contract_completed) {
            console.log('⚠️ Contrato ya estaba completado');

            // Speed-form safety net: if the first webhook marked the contract
            // complete but the doc release failed midway, a retry lands here —
            // releaseSpeedFormDocs is idempotent (no-ops once the pending list
            // is cleared), so re-attempting is safe.
            try {
                await releaseSpeedFormDocs(supabase, client_data.id);
            } catch (releaseErr) {
                console.error('⚠️ Speed-form doc release retry threw (non-fatal):', releaseErr);
            }

            return NextResponse.json(
                {
                    success: true,
                    message: 'Contract already marked as completed',
                    client_email,
                    client_name: client_data.client_name,
                    already_completed: true
                },
                { status: 200 }
            );
        }

        // 6. Convertir la fecha al formato correcto
        const completed_at = parse_date_to_iso(payload.completed_at);

        console.log('📅 Fecha parseada:', {
            original: payload.completed_at,
            parsed: completed_at
        });

        // 7. Actualizar el registro con el contrato completado
        const { data: updated_data, error: update_error } = await supabase
            .from('client_data_vault')
            .update({
                contract_completed: true,
                contract_completed_at: completed_at,
                updated_at: new Date().toISOString()
            })
            .eq('id', client_data.id)
            .select()
            .single();

        if (update_error) {
            console.error('❌ Error actualizando cliente:', update_error);
            return NextResponse.json(
                {
                    success: false,
                    error: 'Database error while updating client',
                    details: update_error.message
                },
                { status: 500 }
            );
        }

        // 7.5 Advance pipeline: signing the Signwell contract IS the
        //     "onboarding complete" event for this app. Push the client past
        //     onboarding into documents_requested so the advisor's pipeline
        //     view reflects reality without any manual click.
        //
        //     Idempotent: skip the insert if the pipeline is already at or past
        //     documents_requested (e.g. webhook fired twice, or advisor already
        //     advanced manually).
        try {
            const PAST_ONBOARDING = new Set([
                'documents_requested',
                'documents_received',
                'under_review',
                'lender_matched',
                'funded',
                'declined',
            ]);
            const { data: latestStatus } = await supabase
                .from('loan_status_history')
                .select('status')
                .eq('client_vault_id', client_data.id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!latestStatus || !PAST_ONBOARDING.has(latestStatus.status)) {
                const { error: pipelineError } = await supabase
                    .from('loan_status_history')
                    .insert({
                        client_vault_id: client_data.id,
                        status: 'documents_requested',
                        changed_by: client_data.user_id,
                        changed_by_role: 'client',
                        note: 'Onboarding completed — Signwell contract signed',
                    });
                if (pipelineError) {
                    console.error('⚠️ Failed to advance pipeline status (non-fatal):', pipelineError);
                } else {
                    console.log('✅ Pipeline advanced: onboarding → documents_requested');
                }
            }
        } catch (pipelineCatch) {
            console.error('⚠️ Pipeline advance threw (non-fatal):', pipelineCatch);
        }

        // 7.6 Speed-form flow: the signature is the gate for the document
        //     request. Seed client_dynamic_documents from the parked
        //     pending_document_requests, apply the requested_* GHL tags, sync
        //     the outstanding-docs field, and email the client a complete
        //     document request (docs + proposed loan type + funding amount).
        //     No-op for standard-flow clients (signup_flow !== 'speed').
        try {
            const releaseResult = await releaseSpeedFormDocs(supabase, client_data.id);
            if (releaseResult.released) {
                console.log('✅ Speed-form document requests released after signature');
            }
        } catch (releaseErr) {
            console.error('⚠️ Speed-form doc release threw (non-fatal):', releaseErr);
        }

        // 8. Download SignWell PDF and upload to vault
        console.log('📄 Downloading signed contract from SignWell...');

        try {
            const documentId = payload.document_id || payload.contract_id;

            if (!documentId) {
                console.warn('⚠️ No document_id provided in payload, skipping PDF download');
            } else {
                const { blob } = await signWell.getCompletedPDF({
                    documentId,
                    urlOnly: false,
                    auditPage: true
                });

                if (!blob) {
                    throw new Error('Failed to get completed PDF blob from SignWell');
                }

                const pdfBuffer = await blob.arrayBuffer();
                console.log(`✅ Downloaded PDF (${(pdfBuffer.byteLength / 1024).toFixed(2)} KB)`);

                // Create storage path
                const fileName = `funding_application-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.pdf`;
                const filePath = `${client_data.user_id}/${fileName}`;

                const { error: uploadError } = await supabase.storage
                    .from('user-documents')
                    .upload(filePath, pdfBuffer, {
                        contentType: 'application/pdf',
                        upsert: false
                    });

                if (uploadError) {
                    throw new Error(`Storage upload error: ${uploadError.message}`);
                }

                console.log(`✅ Uploaded PDF to storage: ${filePath}`);

                // Scope the signed funding application to a business. The
                // advisor / admin / UW client views and the client's own vault
                // all filter documents by the active business tab
                // (matchesActiveBusiness), and funding_application is NOT a
                // client-scoped code — so a NULL business_profile_id row matches
                // no tab and stays invisible even though the PDF exists. Prefer
                // the business resolved from the matched funding_deal (multi-
                // business contracts); fall back to the client's primary
                // business. Mirrors addManualFundingApplication's scoping.
                let docBusinessProfileId = matchedBusinessProfileId;
                if (!docBusinessProfileId) {
                    const { data: primaryBiz } = await supabase
                        .from('business_profiles')
                        .select('id')
                        .eq('client_vault_id', client_data.id)
                        .eq('is_primary', true)
                        .maybeSingle();
                    docBusinessProfileId = primaryBiz?.id ?? null;
                }

                // Create database record in user_documents
                const { data: docRecord, error: dbError } = await supabase
                    .from('user_documents')
                    .insert({
                        user_id: client_data.user_id,
                        name: `Funding Application - ${client_data.client_name}.pdf`,
                        size: pdfBuffer.byteLength,
                        type: 'application/pdf',
                        storage_path: filePath,
                        category: 'funding_application',
                        doc_code: 'funding_application',
                        business_profile_id: docBusinessProfileId,
                        funding_deal_id: matchedFundingDealId,
                        custom_label: `Funding Application - ${client_data.client_name}`,
                        metadata: {
                            tags: ['funding_application', 'signwell', 'auto-uploaded'],
                            source: 'signwell_webhook',
                            document_id: documentId
                        }
                    })
                    .select('*')
                    .single();

                if (dbError) {
                    throw new Error(`Database insert error: ${dbError.message}`);
                }

                console.log(`✅ Created document record: ${docRecord.id}`);

                // 8.5 Sync to GHL using the shared utility
                try {
                    const { ghlSyncDocument } = await import('@/lib/ghl-document-sync');
                    const syncResult = await ghlSyncDocument(
                        supabase,
                        docRecord.id,
                        client_data.user_id,
                        'funding_application'
                    );

                    if (syncResult.success) {
                        console.log(`✅ Successfully synced funding application to GHL`);
                    } else {
                        console.error(`❌ Failed to sync to GHL:`, syncResult.error);
                    }
                } catch (syncError) {
                    console.error('❌ Error calling ghlSyncDocument:', syncError);
                }
            }
        } catch (pdfError: any) {
            console.error('❌ Error downloading/uploading PDF:', pdfError);
            // Don't fail the webhook - contract is still marked as completed
        }

        // 9. Respuesta exitosa
        console.log('✅ Contrato marcado como completado exitosamente');

        return NextResponse.json(
            {
                success: true,
                message: 'Contract marked as completed successfully',
                data: {
                    client_email: updated_data.client_email,
                    client_name: updated_data.client_name,
                    contract_completed: updated_data.contract_completed,
                    contract_completed_at: updated_data.contract_completed_at
                }
            },
            { status: 200 }
        );

    } catch (error: any) {
        console.error('❌ Error procesando webhook:', error);

        return NextResponse.json(
            {
                success: false,
                error: 'Internal server error',
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            { status: 500 }
        );
    }
}

/**
 * Helper: Parsear diferentes formatos de fecha a ISO 8601
 * Maneja: "12/17/25", "2024-12-17", timestamps, etc.
 */
function parse_date_to_iso(date_input: any): string {
    // Si no hay fecha, usar fecha actual
    if (!date_input) {
        return new Date().toISOString();
    }

    // Si ya es un formato válido ISO
    if (typeof date_input === 'string' && date_input.includes('T')) {
        return new Date(date_input).toISOString();
    }

    // Si es formato MM/DD/YY (como "12/17/25")
    if (typeof date_input === 'string' && date_input.includes('/')) {
        const parts = date_input.split('/');

        if (parts.length === 3) {
            let [month, day, year] = parts;

            // Convertir año de 2 dígitos a 4 dígitos
            if (year.length === 2) {
                // Si el año es 00-49, asumimos 2000-2049
                // Si el año es 50-99, asumimos 1950-1999
                year = parseInt(year) < 50 ? `20${year}` : `19${year}`;
            }

            // Crear fecha en formato ISO
            const iso_date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
            return iso_date.toISOString();
        }
    }

    // Intentar parsear cualquier otro formato
    try {
        return new Date(date_input).toISOString();
    } catch {
        // Si todo falla, usar fecha actual
        console.warn('⚠️ No se pudo parsear la fecha, usando fecha actual');
        return new Date().toISOString();
    }
}

/**
 * GET /api/webhooks/signwell-contract
 * Endpoint de prueba para verificar que la ruta funciona
 */
export async function GET(request: NextRequest) {
    return NextResponse.json(
        {
            status: 'active',
            endpoint: '/api/webhooks/signwell-contract',
            method: 'POST',
            description: 'Webhook receiver for SignWell contract completions via Zapier',
            required_fields: {
                secret: 'string - Security token from environment variable',
                client_email: 'string - Email of the client who completed the contract'
            },
            optional_fields: {
                contract_id: 'string - Document ID from SignWell',
                completed_at: 'string - Completion date (supports multiple formats)'
            },
            supported_date_formats: [
                'MM/DD/YY (e.g., 12/17/25)',
                'YYYY-MM-DD (e.g., 2025-12-17)',
                'ISO 8601 (e.g., 2025-12-17T10:30:00Z)'
            ],
            test_curl: `curl -X POST ${request.nextUrl.origin}/api/webhooks/signwell-contract -H "Content-Type: application/json" -d '{"secret":"YOUR_SECRET","client_email":"test@example.com"}'`
        },
        { status: 200 }
    );
}

/**
 * OPTIONS handler para CORS (si lo necesitas)
 */
export async function OPTIONS(request: NextRequest) {
    return NextResponse.json(
        {},
        {
            status: 200,
            headers: {
                'Allow': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        }
    );
}