//src/app/api/webhooks/singwell-contract/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

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

        // 4. Buscar el registro del cliente en la base de datos
        const { data: client_data, error: fetch_error } = await supabase
            .from('client_data_vault')
            .select('id, client_email, client_name, contract_completed')
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

        // 8. Respuesta exitosa
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