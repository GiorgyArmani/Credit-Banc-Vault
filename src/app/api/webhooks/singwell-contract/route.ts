import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Cliente de Supabase con service role para operaciones del servidor
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Token de seguridad para validar que el webhook viene de Zapier
const WEBHOOK_SECRET = process.env.SIGNWELL_WEBHOOK_SECRET!;

/**
 * POST /api/webhooks/signwell-contract
 * Recibe webhooks de Zapier cuando un contrato se completa en SignWell
 * 
 * Expected payload formato JSON:
 * {
 *   "secret": "tu-token-secreto",
 *   "client_email": "cliente@ejemplo.com",
 *   "contract_id": "signwell_doc_id",
 *   "completed_at": "2024-12-17T10:30:00Z"
 * }
 */
export async function POST(request: NextRequest) {
    try {
        // 1. Obtener el content-type para saber cómo parsear el body
        const content_type = request.headers.get('content-type') || '';

        let payload: any = {};

        // 2. Parsear el body según el formato enviado por Zapier
        if (content_type.includes('application/json')) {
            // Formato JSON (recomendado)
            payload = await request.json();

        } else if (content_type.includes('application/xml') || content_type.includes('text/xml')) {
            // Formato XML
            const xml_text = await request.text();
            payload = parse_xml_to_object(xml_text);

        } else {
            // Formato raw/text o form data
            const raw_text = await request.text();

            // Si es form-urlencoded, parsearlo
            if (content_type.includes('application/x-www-form-urlencoded')) {
                const params = new URLSearchParams(raw_text);
                payload = Object.fromEntries(params);
            } else {
                // Si es texto plano, intentar parsearlo como JSON
                try {
                    payload = JSON.parse(raw_text);
                } catch {
                    payload = { raw_data: raw_text };
                }
            }
        }

        console.log('📥 Webhook recibido:', {
            content_type,
            payload_keys: Object.keys(payload)
        });

        // 3. Validar el token de seguridad
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

        // 4. Validar que tenemos el email del cliente
        const client_email = payload.client_email || payload.email;

        if (!client_email) {
            console.error('❌ Email del cliente no proporcionado');
            return NextResponse.json(
                {
                    success: false,
                    error: 'Bad Request - client_email is required'
                },
                { status: 400 }
            );
        }

        // 5. Buscar el registro del cliente en la base de datos
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
            console.error('❌ Cliente no encontrado:', client_email);
            return NextResponse.json(
                {
                    success: false,
                    error: 'Client not found with provided email',
                    client_email
                },
                { status: 404 }
            );
        }

        // 6. Verificar si el contrato ya estaba marcado como completado
        if (client_data.contract_completed) {
            console.log('⚠️ Contrato ya estaba completado para:', client_email);
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

        // 7. Actualizar el registro con el contrato completado
        const completed_at = payload.completed_at
            ? new Date(payload.completed_at).toISOString()
            : new Date().toISOString();

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
        console.log('✅ Contrato marcado como completado:', {
            client_email,
            client_name: client_data.client_name,
            completed_at
        });

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
                message: error.message
            },
            { status: 500 }
        );
    }
}

/**
 * Helper function: Parsear XML a objeto JavaScript
 */
function parse_xml_to_object(xml_string: string): any {
    // Parser básico de XML a objeto
    const result: any = {};

    // Expresión regular para extraer tags XML
    const tag_regex = /<(\w+)>([^<]+)<\/\1>/g;
    let match;

    while ((match = tag_regex.exec(xml_string)) !== null) {
        const [, key, value] = match;
        result[key] = value;
    }

    return result;
}

// GET handler para testing (opcional)
export async function GET(request: NextRequest) {
    return NextResponse.json(
        {
            endpoint: '/api/webhooks/signwell-contract',
            method: 'POST',
            description: 'Webhook receiver for SignWell contract completions via Zapier',
            required_fields: ['secret', 'client_email'],
            optional_fields: ['contract_id', 'completed_at'],
            supported_formats: ['application/json', 'application/xml', 'text/plain']
        },
        { status: 200 }
    );
}