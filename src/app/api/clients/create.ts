/**
 * ============================================================================
 * API ENDPOINT: /api/clients/create
 * ============================================================================
 * 
 * Este endpoint es llamado por el SignupForm cuando un advisor crea un
 * nuevo cliente. 
 * 
 * FLUJO:
 * 1. Recibe datos del formulario
 * 2. Valida campos requeridos
 * 3. Crea usuario en Supabase Auth
 * 4. Inserta datos en client_data_vault
 * 5. Crea/actualiza contacto en GHL con custom fields
 * 6. Retorna ID del cliente creado
 * 
 * ============================================================================
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

// Cliente de Supabase con service role
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

/**
 * Crea o actualiza un contacto en GoHighLevel
 * @param client_data - Datos del cliente
 * @returns ID del contacto en GHL
 */
async function create_or_update_ghl_contact(client_data: any): Promise<string> {
  const ghl_api_key = process.env.GHL_API_KEY;
  const ghl_location_id = process.env.GHL_LOCATION_ID;
  
  if (!ghl_api_key || !ghl_location_id) {
    throw new Error('GHL credentials not configured');
  }
  
  // Buscar contacto existente por email
  const search_response = await fetch(
    `https://rest.gohighlevel.com/v1/contacts/?locationId=${ghl_location_id}&email=${encodeURIComponent(client_data.client_email)}`,
    {
      headers: {
        'Authorization': `Bearer ${ghl_api_key}`,
        'Content-Type': 'application/json'
      }
    }
  );
  
  if (!search_response.ok) {
    throw new Error('Error searching GHL contact');
  }
  
  const search_data = await search_response.json();
  const existing_contact = search_data.contacts?.[0];
  
  // Preparar custom fields para GHL
  // Mapeo: campo_db → GHL Custom Field Key
  const custom_fields = {
    '[Data Vault] Client Name': client_data.client_name,
    '[Data Vault] Company Name': client_data.company_name,
    '[Data Vault] Client Phone': client_data.client_phone,
    '[Data Vault] Client Email': client_data.client_email,
    '[Data Vault] Company State': client_data.company_state,
    '[Data Vault] Company City': client_data.company_city || '',
    '[Data Vault] Company ZIP Code': client_data.company_zip_code,
    '[Data Vault] Capital Requested': client_data.capital_requested.toString(),
    '[Data Vault] Business Loan Purpose': client_data.loan_purpose,
    '[Data Vault] Proposed Loan Type': client_data.proposed_loan_type,
    '[Data Vault] Average Monthly Deposits': client_data.avg_monthly_deposits.toString(),
    '[Data Vault] Average Annual Revenue': client_data.avg_annual_revenue.toString(),
    '[Data Vault] Legal Entity Type': client_data.legal_entity_type,
    '[Data Vault] Business Start Date': client_data.business_start_date,
    '[Data Vault] Home-Based Business': client_data.is_home_based ? 'Yes' : 'No',
    '[Data Vault] Number of Employees': client_data.employees_count.toString(),
    '[Data Vault] Number of Owners': client_data.number_of_owners,
    '[Data Vault] Owner 1 Name': client_data.owner_1_name,
    '[Data Vault] Owner 1 Ownership %': client_data.owner_1_ownership_pct.toString(),
    '[Data Vault] Owner 2 Name': client_data.owner_2_name || '',
    '[Data Vault] Owner 2 Ownership %': client_data.owner_2_ownership_pct?.toString() || '',
    '[Data Vault] Owner 3 Name': client_data.owner_3_name || '',
    '[Data Vault] Owner 3 Ownership %': client_data.owner_3_ownership_pct?.toString() || '',
    '[Data Vault] Owner 4 Name': client_data.owner_4_name || '',
    '[Data Vault] Owner 4 Ownership %': client_data.owner_4_ownership_pct?.toString() || '',
    '[Data Vault] Owner 5 Name': client_data.owner_5_name || '',
    '[Data Vault] Owner 5 Ownership %': client_data.owner_5_ownership_pct?.toString() || '',
    '[Data Vault] Credit Score': client_data.credit_score,
    '[Data Vault] Existing Loans': client_data.has_existing_loans ? 'Yes' : 'No',
    '[Data Vault] MCA Default Status': client_data.has_defaulted_mca ? 'Yes' : 'No',
    '[Data Vault] MCA Satisfaction Status': client_data.mca_was_satisfied ? 'Yes' : 'No',
    '[Data Vault] Real Estate Ownership': client_data.owns_real_estate ? 'Yes' : 'No',
    '[Data Vault] MCA Payments Reduction': client_data.has_reduced_mca_payments ? 'Yes' : 'No',
    '[Data Vault] Personal Debt Over 75K': client_data.has_personal_debt_over_75k ? 'Yes' : 'No',
    '[Data Vault] Bankruptcy or Foreclosure History': client_data.has_bankruptcy_foreclosure_3y ? 'Yes' : 'No',
    '[Data Vault] Client Tax Liens': client_data.has_tax_liens ? 'Yes' : 'No',
    '[Data Vault] Active Judgements': client_data.has_active_judgements ? 'Yes' : 'No',
    '[Data Vault] ZBL Status': client_data.has_zbl ? 'Yes' : 'No',
    '[Data Vault] Clients Funding ETA': client_data.funding_eta,
    '[Data Vault] Additional Notes': client_data.additional_notes,
    '[Data Vault] Advisor Name': client_data.advisor_name
  };
  
  // Payload base del contacto
  const contact_payload = {
    locationId: ghl_location_id,
    firstName: client_data.client_name.split(' ')[0],
    lastName: client_data.client_name.split(' ').slice(1).join(' ') || '',
    email: client_data.client_email,
    phone: client_data.client_phone,
    companyName: client_data.company_name,
    customFields: custom_fields
  };
  
  let ghl_contact_id: string;
  
  if (existing_contact) {
    // Actualizar contacto existente
    const update_response = await fetch(
      `https://rest.gohighlevel.com/v1/contacts/${existing_contact.id}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${ghl_api_key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(contact_payload)
      }
    );
    
    if (!update_response.ok) {
      const error_data = await update_response.json();
      throw new Error(`Error updating GHL contact: ${JSON.stringify(error_data)}`);
    }
    
    ghl_contact_id = existing_contact.id;
    console.log(`✅ GHL contact updated: ${ghl_contact_id}`);
    
  } else {
    // Crear nuevo contacto
    const create_response = await fetch(
      'https://rest.gohighlevel.com/v1/contacts/',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ghl_api_key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(contact_payload)
      }
    );
    
    if (!create_response.ok) {
      const error_data = await create_response.json();
      throw new Error(`Error creating GHL contact: ${JSON.stringify(error_data)}`);
    }
    
    const create_data = await create_response.json();
    ghl_contact_id = create_data.contact.id;
    console.log(`✅ GHL contact created: ${ghl_contact_id}`);
  }
  
  return ghl_contact_id;
}

/**
 * Crea un usuario en Supabase Auth
 * @param client_data - Datos del cliente
 * @returns ID del usuario creado
 */
async function create_auth_user(client_data: any): Promise<string> {
  // Generar password temporal seguro
  const temp_password = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  // Crear usuario en Auth
  const { data: auth_data, error: auth_error } = await supabase.auth.admin.createUser({
    email: client_data.client_email,
    phone: client_data.client_phone,
    password: temp_password,
    email_confirm: true,
    user_metadata: {
      full_name: client_data.client_name,
      company_name: client_data.company_name,
      created_by_advisor: client_data.advisor_name,
      requires_password_setup: true
    }
  });
  
  if (auth_error) {
    throw new Error(`Error creating auth user: ${auth_error.message}`);
  }
  
  if (!auth_data.user) {
    throw new Error('No user returned from auth creation');
  }
  
  console.log(`✅ Auth user created: ${auth_data.user.id}`);
  return auth_data.user.id;
}

/**
 * Busca o crea el advisor en la tabla de advisors
 * @param advisor_name - Nombre del advisor
 * @returns ID del advisor
 */
async function get_or_create_advisor(advisor_name: string): Promise<string | null> {
  if (!advisor_name) return null;
  
  // Buscar advisor existente
  const { data: existing_advisor } = await supabase
    .from('advisors')
    .select('id')
    .ilike('first_name', `%${advisor_name}%`)
    .single();
  
  if (existing_advisor) {
    return existing_advisor.id;
  }
  
  // Crear nuevo advisor
  const name_parts = advisor_name.split(' ');
  const first_name = name_parts[0];
  const last_name = name_parts.slice(1).join(' ') || '';
  
  const { data: new_advisor, error } = await supabase
    .from('advisors')
    .insert({
      first_name,
      last_name,
      email: `${first_name.toLowerCase()}@advisors.temp`,
      is_active: true
    })
    .select('id')
    .single();
  
  if (error) {
    console.error('Error creating advisor:', error);
    return null;
  }
  
  return new_advisor?.id || null;
}

/**
 * Inserta los datos del cliente en client_data_vault
 * @param user_id - ID del usuario en Auth
 * @param client_data - Datos del cliente
 * @param ghl_contact_id - ID del contacto en GHL
 * @returns ID del registro creado
 */
async function insert_client_data(
  user_id: string,
  client_data: any,
  ghl_contact_id: string
): Promise<string> {
  // Obtener o crear advisor
  const advisor_id = await get_or_create_advisor(client_data.advisor_name);
  
  // Preparar datos para inserción
  const insert_data = {
    user_id,
    
    // Información básica
    client_name: client_data.client_name,
    company_name: client_data.company_name,
    client_phone: client_data.client_phone,
    client_email: client_data.client_email,
    
    // Ubicación
    company_state: client_data.company_state,
    company_city: client_data.company_city,
    company_zip_code: client_data.company_zip_code,
    
    // Financiero
    capital_requested: parseFloat(client_data.capital_requested),
    loan_purpose: client_data.loan_purpose,
    proposed_loan_type: client_data.proposed_loan_type,
    avg_monthly_deposits: parseFloat(client_data.avg_monthly_deposits),
    avg_annual_revenue: parseFloat(client_data.avg_annual_revenue),
    
    // Estructura
    legal_entity_type: client_data.legal_entity_type,
    business_start_date: client_data.business_start_date,
    is_home_based: client_data.is_home_based,
    employees_count: parseInt(client_data.employees_count),
    
    // Propietarios
    number_of_owners: client_data.number_of_owners,
    owner_1_name: client_data.owner_1_name,
    owner_1_ownership_pct: parseFloat(client_data.owner_1_ownership_pct),
    owner_2_name: client_data.owner_2_name || null,
    owner_2_ownership_pct: client_data.owner_2_ownership_pct ? parseFloat(client_data.owner_2_ownership_pct) : null,
    owner_3_name: client_data.owner_3_name || null,
    owner_3_ownership_pct: client_data.owner_3_ownership_pct ? parseFloat(client_data.owner_3_ownership_pct) : null,
    owner_4_name: client_data.owner_4_name || null,
    owner_4_ownership_pct: client_data.owner_4_ownership_pct ? parseFloat(client_data.owner_4_ownership_pct) : null,
    owner_5_name: client_data.owner_5_name || null,
    owner_5_ownership_pct: client_data.owner_5_ownership_pct ? parseFloat(client_data.owner_5_ownership_pct) : null,
    
    // Crédito
    credit_score: client_data.credit_score,
    
    // Flags
    has_existing_loans: client_data.has_existing_loans,
    has_defaulted_mca: client_data.has_defaulted_mca,
    mca_was_satisfied: client_data.mca_was_satisfied,
    owns_real_estate: client_data.owns_real_estate,
    has_reduced_mca_payments: client_data.has_reduced_mca_payments,
    has_personal_debt_over_75k: client_data.has_personal_debt_over_75k,
    has_bankruptcy_foreclosure_3y: client_data.has_bankruptcy_foreclosure_3y,
    has_tax_liens: client_data.has_tax_liens,
    has_active_judgements: client_data.has_active_judgements,
    has_zbl: client_data.has_zbl,
    
    // Timeline
    funding_eta: client_data.funding_eta,
    additional_notes: client_data.additional_notes,
    
    // Advisor
    advisor_name: client_data.advisor_name,
    advisor_id,
    
    // GHL
    ghl_contact_id,
    ghl_last_sync_at: new Date().toISOString(),
    
    // Metadata
    status: 'active',
    submitted_at: new Date().toISOString()
  };
  
  // Insertar en client_data_vault
  const { data, error } = await supabase
    .from('client_data_vault')
    .insert(insert_data)
    .select('id')
    .single();
  
  if (error) {
    throw new Error(`Error inserting client data: ${error.message}`);
  }
  
  if (!data) {
    throw new Error('No data returned from client insert');
  }
  
  console.log(`✅ Client data inserted: ${data.id}`);
  return data.id;
}

/**
 * Handler principal del endpoint
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Solo aceptar POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
      message: 'Only POST requests are accepted'
    });
  }
  
  try {
    const client_data = req.body;
    
    console.log('📥 Creating new client:', client_data.client_email);
    
    // ========================================================================
    // 1. VALIDAR CAMPOS REQUERIDOS
    // ========================================================================
    
    const required_fields = [
      'client_name', 'company_name', 'client_phone', 'client_email',
      'company_state', 'company_zip_code',
      'capital_requested', 'loan_purpose', 'proposed_loan_type',
      'avg_monthly_deposits', 'avg_annual_revenue',
      'legal_entity_type', 'business_start_date', 'employees_count',
      'owner_1_name', 'owner_1_ownership_pct',
      'credit_score', 'funding_eta', 'additional_notes', 'advisor_name'
    ];
    
    const missing_fields = required_fields.filter(field => !client_data[field]);
    
    if (missing_fields.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        missing_fields
      });
    }
    
    console.log('✅ Validation passed');
    
    // ========================================================================
    // 2. VERIFICAR SI EL CLIENTE YA EXISTE
    // ========================================================================
    
    const { data: existing_client } = await supabase
      .from('client_data_vault')
      .select('id, user_id')
      .eq('client_email', client_data.client_email)
      .single();
    
    if (existing_client) {
      console.log('⚠️  Client already exists:', existing_client.user_id);
      
      // Actualizar contacto en GHL
      const ghl_contact_id = await create_or_update_ghl_contact(client_data);
      
      // Actualizar datos existentes
      const { error: update_error } = await supabase
        .from('client_data_vault')
        .update({
          ...client_data,
          ghl_contact_id,
          updated_at: new Date().toISOString(),
          ghl_last_sync_at: new Date().toISOString()
        })
        .eq('id', existing_client.id);
      
      if (update_error) {
        throw new Error(`Error updating client: ${update_error.message}`);
      }
      
      return res.status(200).json({
        success: true,
        message: 'Client updated successfully',
        client_id: existing_client.id,
        user_id: existing_client.user_id,
        action: 'updated'
      });
    }
    
    // ========================================================================
    // 3. CREAR CONTACTO EN GHL
    // ========================================================================
    
    console.log('📤 Creating GHL contact...');
    const ghl_contact_id = await create_or_update_ghl_contact(client_data);
    
    // ========================================================================
    // 4. CREAR USUARIO EN AUTH
    // ========================================================================
    
    console.log('👤 Creating auth user...');
    const user_id = await create_auth_user(client_data);
    
    // ========================================================================
    // 5. INSERTAR DATOS EN CLIENT_DATA_VAULT
    // ========================================================================
    
    console.log('💾 Inserting client data...');
    const client_id = await insert_client_data(user_id, client_data, ghl_contact_id);
    
    // ========================================================================
    // 6. RESPONDER ÉXITO
    // ========================================================================
    
    console.log('🎉 Client created successfully');
    
    return res.status(201).json({
      success: true,
      message: 'Client created successfully',
      client_id,
      user_id,
      ghl_contact_id,
      action: 'created'
    });
    
  } catch (error: any) {
    console.error('💥 Error creating client:', error);
    
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Error creating client',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}