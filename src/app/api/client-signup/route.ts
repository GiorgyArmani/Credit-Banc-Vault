// src/app/api/client-signup/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { send_client_welcome_email } from '@/lib/email';
/**
 * Cliente Supabase con privilegios elevados
 * Necesario para crear usuarios y escribir en tablas protegidas
 */
const supabase_admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

/**
 * Contraseña por defecto para todos los nuevos clientes
 * Los usuarios deberán cambiarla en su primer inicio de sesión
 */
const DEFAULT_PASSWORD = 'CBvault2025!';

/**
 * ============================================================================
 * FUNCIONES AUXILIARES PARA GHL
 * ============================================================================
 */

/**
 * Crea o actualiza un contacto en GoHighLevel usando la API v2
 * Usa el endpoint /upsert que maneja crear o actualizar en una sola llamada
 * @param contact_data - Datos del contacto
 * @returns ID del contacto en GHL
 */
async function ghl_upsert_contact(contact_data: any): Promise<string> {
  const ghl_api_key = process.env.GHL_API_KEY;
  const ghl_location_id = process.env.GHL_LOCATION_ID;

  // Validar que las credenciales de GHL estén configuradas
  if (!ghl_api_key || !ghl_location_id) {
    throw new Error('GHL_API_KEY o GHL_LOCATION_ID no están configurados en las variables de entorno');
  }

  // Usar el endpoint /upsert de la API v2 de GoHighLevel
  // Este endpoint crea o actualiza automáticamente basado en el email
  const upsert_response = await fetch(
    'https://services.leadconnectorhq.com/contacts/upsert',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ghl_api_key}`,
        'Version': '2021-07-28',  // Header requerido por GHL API v2
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(contact_data)
    }
  );

  // Manejar errores de la respuesta
  if (!upsert_response.ok) {
    const error_text = await upsert_response.text();
    console.error('❌ Error en GHL upsert:', {
      status: upsert_response.status,
      statusText: upsert_response.statusText,
      error: error_text
    });
    throw new Error(`Error al crear/actualizar contacto en GHL (${upsert_response.status}): ${error_text}`);
  }

  // Parsear respuesta exitosa
  const response_data = await upsert_response.json();

  // La API puede retornar el ID en diferentes formatos
  // {contact: {id: "xxx"}} o {id: "xxx"}
  const contact_id = response_data.contact?.id || response_data.id;

  if (!contact_id) {
    console.error('❌ Respuesta de GHL sin ID de contacto:', response_data);
    throw new Error('La respuesta de GHL no incluye un ID de contacto válido');
  }

  return contact_id;
}

/**
 * Agrega tags a un contacto en GHL usando la API v2
 * @param contact_id - ID del contacto en GHL
 * @param tags - Array de tags a aplicar
 */
async function ghl_add_tags(contact_id: string, tags: string[]): Promise<void> {
  const ghl_api_key = process.env.GHL_API_KEY;

  if (!ghl_api_key) {
    throw new Error('GHL_API_KEY no está configurado');
  }

  if (!tags || tags.length === 0) {
    return; // No hay tags que agregar
  }

  const response = await fetch(
    `https://services.leadconnectorhq.com/contacts/${contact_id}/tags`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ghl_api_key}`,
        'Version': '2021-07-28',  // Header requerido por GHL API v2
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ tags })
    }
  );

  if (!response.ok) {
    const error_text = await response.text();
    console.error('❌ Error al agregar tags en GHL:', {
      status: response.status,
      contact_id,
      tags,
      error: error_text
    });
    throw new Error(`Error al agregar tags en GHL: ${error_text}`);
  }
}

/**
 * Crea un objeto de custom field para GHL si el valor existe
 * @param field_id_env - Nombre de la variable de entorno con el field ID
 * @param value - Valor del campo
 * @returns Objeto de custom field o null
 */
function create_custom_field(field_id_env: string, value: any) {
  // Si el valor es null, undefined o string vacío, no crear el campo
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const field_id = process.env[field_id_env];

  if (!field_id) {
    console.warn(`⚠️ Custom field ID no encontrado en .env: ${field_id_env}`);
    return null;
  }

  return {
    id: field_id,
    value: String(value) // GHL siempre espera strings en custom fields
  };
}

/**
 * ============================================================================
 * FUNCIONES AUXILIARES DE VALIDACIÓN
 * ============================================================================
 */

/**
 * Valida que un email tenga formato correcto
 */
function is_valid_email(email: string): boolean {
  const email_regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return email_regex.test(email);
}

/**
 * Valida que un número sea válido y mayor a 0
 */
function is_valid_positive_number(value: any): boolean {
  const num = parseFloat(value);
  return !isNaN(num) && num > 0;
}

/**
 * Valida que los porcentajes de ownership sumen exactamente 100
 */
function validate_ownership_percentages(body: any): { valid: boolean; message?: string } {
  let total = 0;

  if (body.owner_1_ownership_pct) {
    total += parseFloat(body.owner_1_ownership_pct);
  }
  if (body.owner_2_ownership_pct) {
    total += parseFloat(body.owner_2_ownership_pct);
  }
  if (body.owner_3_ownership_pct) {
    total += parseFloat(body.owner_3_ownership_pct);
  }
  if (body.owner_4_ownership_pct) {
    total += parseFloat(body.owner_4_ownership_pct);
  }
  if (body.owner_5_ownership_pct) {
    total += parseFloat(body.owner_5_ownership_pct);
  }

  // Permitir pequeña diferencia por redondeo (0.01%)
  if (Math.abs(total - 100) > 0.01) {
    return {
      valid: false,
      message: `Los porcentajes de ownership deben sumar 100% (actualmente suman ${total}%)`
    };
  }

  return { valid: true };
}

/**
 * ============================================================================
 * HANDLER PRINCIPAL - POST /api/client-signup
 * ============================================================================
 */
export async function POST(request: Request) {
  try {
    console.log('🚀 Iniciando proceso de signup de cliente...');

    // ========== PASO 1: PARSEAR Y VALIDAR REQUEST ==========
    const body = await request.json();

    // Validación de campos requeridos básicos
    if (!body.client_name || !body.company_name || !body.client_email) {
      return NextResponse.json(
        {
          success: false,
          error: 'Faltan campos requeridos: client_name, company_name, client_email'
        },
        { status: 400 }
      );
    }

    // Validar formato de email
    if (!is_valid_email(body.client_email)) {
      return NextResponse.json(
        {
          success: false,
          error: 'El email proporcionado no tiene un formato válido'
        },
        { status: 400 }
      );
    }

    // Validar que capital_requested sea un número válido
    if (!is_valid_positive_number(body.capital_requested)) {
      return NextResponse.json(
        {
          success: false,
          error: 'El capital solicitado debe ser un número mayor a 0'
        },
        { status: 400 }
      );
    }

    // Validar porcentajes de ownership
    const ownership_validation = validate_ownership_percentages(body);
    if (!ownership_validation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: ownership_validation.message
        },
        { status: 400 }
      );
    }

    console.log('✅ Validaciones básicas pasadas');

    // ========== PASO 2: CREAR/ACTUALIZAR USUARIO EN AUTH ==========
    const { data: existing_user } = await supabase_admin.auth.admin
      .listUsers()
      .then(res => ({
        data: res.data.users.find(u => u.email === body.client_email.toLowerCase())
      }));

    let user_id = existing_user?.id;

    if (!user_id) {
      // CREAR nuevo usuario
      const { data: created_user, error: create_error } = await supabase_admin.auth.admin.createUser({
        email: body.client_email.toLowerCase(),
        password: DEFAULT_PASSWORD,
        email_confirm: true, // Auto-confirmar email
        user_metadata: {
          full_name: body.client_name,
          company: body.company_name,
          should_change_password: true, // Flag para forzar cambio de contraseña
          created_by: 'advisor',
          advisor_name: body.advisor_name || 'Unknown'
        },
      });

      if (create_error) {
        console.error('❌ Error al crear usuario:', create_error);
        throw new Error(`Error al crear usuario en Auth: ${create_error.message}`);
      }

      user_id = created_user.user!.id;
      console.log(`✅ Nuevo usuario creado en Auth: ${user_id}`);

    } else {
      // ACTUALIZAR usuario existente
      await supabase_admin.auth.admin.updateUserById(user_id, {
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: {
          should_change_password: true,
          full_name: body.client_name,
          company: body.company_name,
          updated_by: 'advisor',
          advisor_name: body.advisor_name || 'Unknown'
        }
      });

      console.log(`✅ Usuario existente actualizado en Auth: ${user_id}`);
    }

    // ========== PASO 3: PREPARAR CUSTOM FIELDS PARA GHL ==========
    const custom_fields = [
      // Información Básica
      create_custom_field('GHL_CF_CLIENTS_NAME', body.client_name),
      create_custom_field('GHL_CF_BUSINESS_NAME', body.company_name),
      create_custom_field('GHL_CF_CLIENTS_PHONE', body.client_phone),
      create_custom_field('GHL_CF_CLIENT_EMAIL', body.client_email),

      // Ubicación
      create_custom_field('GHL_CF_COMPANY_STATE', body.company_state),
      create_custom_field('GHL_CF_COMPANY_CITY', body.company_city),
      create_custom_field('GHL_CF_COMPANY_ZIP', body.company_zip_code),

      // Información Financiera
      create_custom_field('GHL_CF_CAPITAL_REQUESTED', body.capital_requested),
      create_custom_field('GHL_CF_LOAN_PURPOSE', body.loan_purpose),
      create_custom_field('GHL_CF_PROPOSED_LOAN_TYPE', body.proposed_loan_type),
      create_custom_field('GHL_CF_AVG_MONTHLY_DEPOSITS', body.avg_monthly_deposits),
      create_custom_field('GHL_CF_ANNUAL_REVENUE', body.avg_annual_revenue),

      // Estructura del Negocio
      create_custom_field('GHL_CF_LEGAL_ENTITY_TYPE', body.legal_entity_type),
      create_custom_field('GHL_CF_BUSINESS_START_DATE', body.business_start_date),
      create_custom_field('GHL_CF_IS_HOME_BASED', body.is_home_based ? 'Yes' : 'No'),
      create_custom_field('GHL_CF_EMPLOYEES_COUNT', body.employees_count),

      // Propietarios
      create_custom_field('GHL_CF_NUMBER_OF_OWNERS', body.number_of_owners),
      create_custom_field('GHL_CF_OWNER_1_NAME', body.owner_1_name),
      create_custom_field('GHL_CF_OWNER_1_PCT', body.owner_1_ownership_pct),
      create_custom_field('GHL_CF_OWNER_2_NAME', body.owner_2_name),
      create_custom_field('GHL_CF_OWNER_2_PCT', body.owner_2_ownership_pct),
      create_custom_field('GHL_CF_OWNER_3_NAME', body.owner_3_name),
      create_custom_field('GHL_CF_OWNER_3_PCT', body.owner_3_ownership_pct),
      create_custom_field('GHL_CF_OWNER_4_NAME', body.owner_4_name),
      create_custom_field('GHL_CF_OWNER_4_PCT', body.owner_4_ownership_pct),
      create_custom_field('GHL_CF_OWNER_5_NAME', body.owner_5_name),
      create_custom_field('GHL_CF_OWNER_5_PCT', body.owner_5_ownership_pct),

      // Crédito y Situaciones Especiales
      create_custom_field('GHL_CF_CREDIT_SCORE', body.credit_score),
      create_custom_field('GHL_CF_HAS_EXISTING_LOANS', body.has_existing_loans ? 'Yes' : 'No'),
      create_custom_field('GHL_CF_HAS_DEFAULTED_MCA', body.has_defaulted_mca ? 'Yes' : 'No'),
      create_custom_field('GHL_CF_MCA_WAS_SATISFIED', body.mca_was_satisfied ? 'Yes' : 'No'),
      create_custom_field('GHL_CF_OWNS_REAL_ESTATE', body.owns_real_estate ? 'Yes' : 'No'),
      create_custom_field('GHL_CF_HAS_REDUCED_MCA_PAYMENTS', body.has_reduced_mca_payments ? 'Yes' : 'No'),
      create_custom_field('GHL_CF_HAS_PERSONAL_DEBT_OVER_75K', body.has_personal_debt_over_75k ? 'Yes' : 'No'),
      create_custom_field('GHL_CF_HAS_BANKRUPTCY_FORECLOSURE_3Y', body.has_bankruptcy_foreclosure_3y ? 'Yes' : 'No'),
      create_custom_field('GHL_CF_HAS_TAX_LIENS', body.has_tax_liens ? 'Yes' : 'No'),
      create_custom_field('GHL_CF_HAS_ACTIVE_JUDGEMENTS', body.has_active_judgements ? 'Yes' : 'No'),
      create_custom_field('GHL_CF_HAS_ZBL', body.has_zbl ? 'Yes' : 'No'),

      // Timeline y Notas
      create_custom_field('GHL_CF_FUNDING_ETA', body.funding_eta),
      create_custom_field('GHL_CF_ADDITIONAL_NOTES', body.additional_notes),

    ].filter(Boolean); // Eliminar campos null

    console.log(`✅ ${custom_fields.length} custom fields preparados para GHL`);

    // ========== PASO 3.5: OBTENER INFORMACIÓN DEL ADVISOR ==========
    // Get advisor information including GHL user ID for assignment
    let advisor_ghl_user_id: string | null = null;
    let advisor_email: string | null = null;
    let advisor_phone: string | null = null;

    if (body.advisor_id) {
      const { data: advisor_data } = await supabase_admin
        .from('advisors')
        .select('ghl_user_id, email, phone')
        .eq('id', body.advisor_id)
        .maybeSingle();

      advisor_ghl_user_id = advisor_data?.ghl_user_id || null;
      advisor_email = advisor_data?.email || null;
      advisor_phone = advisor_data?.phone || null;

      if (advisor_ghl_user_id) {
        console.log(`✅ Advisor GHL user ID found: ${advisor_ghl_user_id}`);
      } else {
        console.log(`⚠️ Advisor does not have a GHL user ID set`);
      }
    }

    // ========== PASO 4: CREAR/ACTUALIZAR CONTACTO EN GHL ==========
    const ghl_contact_data: any = {
      locationId: process.env.GHL_LOCATION_ID,
      firstName: body.client_name.split(' ')[0],
      lastName: body.client_name.split(' ').slice(1).join(' ') || '',
      email: body.client_email.toLowerCase(),
      phone: body.client_phone || '',
      companyName: body.company_name,
      city: body.company_city || '',
      state: body.company_state,
      postalCode: body.company_zip_code,
      country: 'US',
      tags: ['vault-user'], // Tag inicial
      customFields: custom_fields
    };

    // Add assignedTo field if advisor has a GHL user ID
    if (advisor_ghl_user_id) {
      ghl_contact_data.assignedTo = advisor_ghl_user_id;
      console.log(`✅ Contact will be assigned to advisor in GHL`);
    }

    const ghl_contact_id = await ghl_upsert_contact(ghl_contact_data);
    console.log(`✅ Contacto GHL creado/actualizado: ${ghl_contact_id}`);

    // ========== PASO 5: GUARDAR EN CLIENT_DATA_VAULT ==========
    // 🔥 CAMBIO IMPORTANTE: Ahora guardamos DIRECTAMENTE en client_data_vault
    const { data: vault_entry, error: vault_error } = await supabase_admin
      .from('client_data_vault')
      .upsert({
        // IDs y referencias
        user_id: user_id,
        advisor_name: body.advisor_name || 'Unknown',
        advisor_id: body.advisor_id || null,
        ghl_contact_id: ghl_contact_id,
        ghl_last_sync_at: new Date().toISOString(),

        // Información básica del cliente
        client_name: body.client_name,
        company_name: body.company_name,
        client_phone: body.client_phone,
        client_email: body.client_email.toLowerCase(),

        // Ubicación de la empresa
        company_state: body.company_state,
        company_city: body.company_city || null,
        company_zip_code: body.company_zip_code,

        // Información financiera (convertir strings a números)
        capital_requested: parseFloat(body.capital_requested),
        loan_purpose: body.loan_purpose,
        proposed_loan_type: body.proposed_loan_type,
        avg_monthly_deposits: parseFloat(body.avg_monthly_deposits),
        avg_annual_revenue: parseFloat(body.avg_annual_revenue),

        // Estructura del negocio
        legal_entity_type: body.legal_entity_type,
        business_start_date: body.business_start_date,
        is_home_based: body.is_home_based || false,
        employees_count: parseInt(body.employees_count),

        // Propietarios
        number_of_owners: body.number_of_owners,
        owner_1_name: body.owner_1_name,
        owner_1_ownership_pct: parseFloat(body.owner_1_ownership_pct),
        owner_2_name: body.owner_2_name || null,
        owner_2_ownership_pct: body.owner_2_ownership_pct ? parseFloat(body.owner_2_ownership_pct) : null,
        owner_3_name: body.owner_3_name || null,
        owner_3_ownership_pct: body.owner_3_ownership_pct ? parseFloat(body.owner_3_ownership_pct) : null,
        owner_4_name: body.owner_4_name || null,
        owner_4_ownership_pct: body.owner_4_ownership_pct ? parseFloat(body.owner_4_ownership_pct) : null,
        owner_5_name: body.owner_5_name || null,
        owner_5_ownership_pct: body.owner_5_ownership_pct ? parseFloat(body.owner_5_ownership_pct) : null,

        // Crédito y situaciones especiales
        credit_score: body.credit_score,
        has_existing_loans: body.has_existing_loans || false,
        has_defaulted_mca: body.has_defaulted_mca || false,
        mca_was_satisfied: body.mca_was_satisfied || null,
        owns_real_estate: body.owns_real_estate || false,
        has_reduced_mca_payments: body.has_reduced_mca_payments || false,
        has_personal_debt_over_75k: body.has_personal_debt_over_75k || null,
        has_bankruptcy_foreclosure_3y: body.has_bankruptcy_foreclosure_3y || false,
        has_tax_liens: body.has_tax_liens || false,
        has_active_judgements: body.has_active_judgements || false,
        has_zbl: body.has_zbl || null,

        // Timeline y notas
        funding_eta: body.funding_eta,
        additional_notes: body.additional_notes,

        // Metadatos
        status: 'active',
        submitted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (vault_error) {
      console.error('❌ Error al guardar en client_data_vault:', vault_error);
      throw new Error(`Error al guardar en client_data_vault: ${vault_error.message}`);
    }

    console.log(`✅ Datos guardados en client_data_vault: ${vault_entry!.id}`);

    // ========== PASO 6: APLICAR TAGS EN GHL ==========
    // Base tags that are always applied to every client
    const base_tags = [
      'portal_created',
      'vault_pre_approval',
    ];

    // Get tags generated by frontend (includes document requests, risk flags, etc.)
    // The frontend generate_ghl_tags() function creates comprehensive tags including:
    // - Risk assessment tags (defaulted-mca, owns-real-estate, etc.)
    // - Credit score category tags (credit-excellent, credit-good, etc.)
    // - Funding urgency tags (urgent-funding, flexible-timeline, etc.)
    // - Document request tags (requested_drivers_license, requested_bank_statements, etc.)
    const frontend_tags = body.ghl_tags || [];

    // Merge base tags with frontend-generated tags
    // Use Set to remove any duplicates that might exist
    const tags_to_apply = [...new Set([...base_tags, ...frontend_tags])];

    // Log tags for debugging
    console.log(`📋 Frontend tags received: ${frontend_tags.length > 0 ? frontend_tags.join(', ') : 'none'}`);
    console.log(`✅ Total tags to apply (${tags_to_apply.length}): ${tags_to_apply.join(', ')}`);

    // Apply all tags to GHL contact
    await ghl_add_tags(ghl_contact_id, tags_to_apply);
    console.log(`✅ Tags applied successfully to GHL contact: ${ghl_contact_id}`);

    // ========== PASO 6.5: ENVIAR EMAIL DE BIENVENIDA ==========
    try {
      // Reuse advisor data already fetched above
      await send_client_welcome_email({
        client_name: body.client_name,
        client_email: body.client_email.toLowerCase(),
        client_password: DEFAULT_PASSWORD,
        advisor_name: body.advisor_name || 'Your Advisor',
        advisor_email: advisor_email || 'support@creditbanc.io',
        advisor_phone: advisor_phone || undefined,
        requested_documents: body.documents_requested || [],
        login_url: `${process.env.NEXT_PUBLIC_APP_URL}/auth/login`,
      });

      console.log(`✅ Welcome email sent successfully to ${body.client_email}`);
    } catch (email_error: any) {
      // Log error but don't fail the whole signup
      // Client account is already created, email is just a nice-to-have
      console.error('⚠️ Error sending welcome email:', email_error);

      // Optional: Save to a failed_emails table to retry later
      // await supabase_admin.from('failed_emails').insert({
      //   email: body.client_email,
      //   type: 'welcome',
      //   error: email_error.message,
      //   data: body
      // });
    }

    // ========== PASO 7: RESPUESTA DE ÉXITO ==========
    console.log('✅ Signup completado exitosamente');

    return NextResponse.json({
      success: true,
      data: {
        vault_id: vault_entry!.id,
        user_id: user_id,
        ghl_contact_id: ghl_contact_id,
        tags_applied: tags_to_apply
      },
      credentials: {
        email: body.client_email.toLowerCase(),
        password: DEFAULT_PASSWORD,
        login_url: `${process.env.NEXT_PUBLIC_APP_URL}/auth/login`
      },
      message: 'Cliente registrado exitosamente'
    }, { status: 201 });

  } catch (error: any) {
    console.error('❌ Error en signup de cliente:', error);

    // Determinar el tipo de error y status code apropiado
    let status_code = 500;
    let error_message = error.message || 'Error interno del servidor';

    if (error.message.includes('GHL')) {
      status_code = 502; // Bad Gateway - error con servicio externo
      error_message = `Error de integración con GoHighLevel: ${error.message}`;
    } else if (error.message.includes('Auth')) {
      status_code = 500;
      error_message = `Error de autenticación: ${error.message}`;
    } else if (error.message.includes('client_data_vault')) {
      status_code = 500;
      error_message = `Error al guardar datos: ${error.message}`;
    }

    return NextResponse.json(
      {
        success: false,
        error: error_message,
        details: process.env.NODE_ENV === 'development' ? {
          stack: error.stack,
          full_error: error
        } : undefined
      },
      { status: status_code }
    );
  }
}