// src/lib/speed-form.ts
//
// Speed-form document release.
//
// Speed-form clients (client_data_vault.signup_flow = 'speed') are created by
// an advisor during the call with NO document requests seeded — the docs the
// rep selected are parked in pending_document_requests. The release happens
// the moment the client signs their pre-filled funding application (SignWell
// webhook), at which point we:
//   1. Seed client_dynamic_documents (scoped to the primary business)
//   2. Clear pending_document_requests (idempotency guard for webhook retries)
//   3. Apply the requested_* GHL tags + sync the outstanding-documents field
//   4. Email the client a complete document request (docs + proposed loan
//      type + funding amount) with a doc-upload magic link
//
// Steps 3-4 are best-effort: a GHL/SMTP hiccup must never undo the signature
// processing. Step 2 runs right after step 1 succeeds so a duplicate webhook
// can't double-send the email.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ghlAddTags } from '@/lib/ghl-api';
import { generateDocUploadMagicLink } from '@/lib/magic-link';
import { syncOutstandingDocuments } from '@/lib/outstanding-documents';
import { send_speed_doc_request_email } from '@/lib/email';
import { packageForLoanTypes } from '@/data/program-document-packages';

export async function releaseSpeedFormDocs(
  supabase: SupabaseClient,
  clientVaultId: string
): Promise<{ released: boolean; reason?: string }> {
  // 1. Load the vault row and bail out unless there is something to release.
  const { data: vault, error: vaultErr } = await supabase
    .from('client_data_vault')
    .select('id, user_id, client_name, client_email, client_phone, company_name, proposed_loan_type, capital_requested, advisor_id, advisor_name, ghl_contact_id, signup_flow, pending_document_requests')
    .eq('id', clientVaultId)
    .maybeSingle();

  if (vaultErr || !vault) {
    console.error('⚠️ releaseSpeedFormDocs: vault row not found', vaultErr);
    return { released: false, reason: 'vault_not_found' };
  }

  if (vault.signup_flow !== 'speed') {
    return { released: false, reason: 'not_speed_flow' };
  }

  const pendingCodes: string[] = Array.isArray(vault.pending_document_requests)
    ? vault.pending_document_requests.filter((c: any) => typeof c === 'string' && c)
    : [];

  if (pendingCodes.length === 0) {
    // Already released (or nothing was ever selected) — nothing to do.
    return { released: false, reason: 'no_pending_docs' };
  }

  console.log(`🚀 Releasing ${pendingCodes.length} pending doc request(s) for speed-form client ${vault.client_email}`);

  // 2. Resolve doc definitions + the primary business to scope the requests to.
  const { data: docDefinitions, error: docLookupErr } = await supabase
    .from('required_documents')
    .select('id, code, label, ghl_tag')
    .in('code', pendingCodes);

  if (docLookupErr || !docDefinitions || docDefinitions.length === 0) {
    console.error('❌ releaseSpeedFormDocs: doc definitions lookup failed', docLookupErr);
    return { released: false, reason: 'doc_lookup_failed' };
  }

  const { data: primaryBusiness } = await supabase
    .from('business_profiles')
    .select('id')
    .eq('client_vault_id', vault.id)
    .eq('is_primary', true)
    .maybeSingle();

  if (!primaryBusiness) {
    console.error('❌ releaseSpeedFormDocs: primary business_profiles row missing — cannot scope doc requests');
    return { released: false, reason: 'no_primary_business' };
  }

  // 3. Seed the dynamic document requests (same shape as /api/client-signup).
  //
  // The bank-statement period comes from the product package rather than from a
  // field on the speed form. The speed form deliberately has no month picker —
  // it is filled in on a call — and the products already state their own period
  // (12 months for nearly all of them). Deriving it here from the loan type the
  // advisor picked keeps the request consistent with the package they saw,
  // without parking a second value in the vault until the signature lands.
  const statementMonths = packageForLoanTypes(
    String(vault.proposed_loan_type || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
  ).statementMonths;

  const dynamicDocRecords = docDefinitions.map(doc => ({
    user_id: vault.user_id,
    document_id: doc.id,
    business_profile_id: primaryBusiness.id,
    is_active: true,
    requested_via: 'speed_form_signature',
    requested_at: new Date().toISOString(),
    // Bank statements carry a per-request month count; other docs ignore it.
    statement_months: doc.code === 'business_bank_statements' ? statementMonths : null,
  }));

  const { error: insertErr } = await supabase
    .from('client_dynamic_documents')
    .upsert(dynamicDocRecords, { onConflict: 'business_profile_id, document_id' });

  if (insertErr) {
    console.error('❌ releaseSpeedFormDocs: failed to seed dynamic documents', insertErr);
    return { released: false, reason: 'doc_seed_failed' };
  }
  console.log(`✅ Seeded ${dynamicDocRecords.length} document request(s) for vault ${vault.id}`);

  // 4. Clear the pending list immediately — a duplicate webhook now no-ops at
  //    the guard above instead of re-tagging / re-emailing.
  const { error: clearErr } = await supabase
    .from('client_data_vault')
    .update({
      pending_document_requests: null,
      pending_docs_released_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', vault.id);
  if (clearErr) {
    console.error('⚠️ releaseSpeedFormDocs: failed to clear pending list (non-fatal)', clearErr);
  }

  // 5. Best-effort GHL sync: requested_* tags + outstanding documents field.
  if (vault.ghl_contact_id) {
    const requestTags = docDefinitions.map(doc => doc.ghl_tag || `requested_${doc.code}`);
    try {
      await ghlAddTags(vault.ghl_contact_id, requestTags);
      console.log(`✅ Applied ${requestTags.length} requested_* tag(s) to GHL contact ${vault.ghl_contact_id}`);
    } catch (tagErr) {
      console.error('⚠️ releaseSpeedFormDocs: GHL tag apply failed (non-fatal)', tagErr);
    }

    if (process.env.GHL_TOKEN) {
      try {
        await syncOutstandingDocuments(vault.user_id, vault.ghl_contact_id, process.env.GHL_TOKEN);
        console.log('✅ Outstanding documents synced to GHL');
      } catch (syncErr) {
        console.error('⚠️ releaseSpeedFormDocs: outstanding docs sync failed (non-fatal)', syncErr);
      }
    }
  } else {
    console.warn('⚠️ releaseSpeedFormDocs: no ghl_contact_id — skipping GHL tag/field sync');
  }

  // 6. Best-effort document request email (client TO, advisor + followers CC).
  try {
    let advisorEmail = 'support@creditbanc.io';
    let advisorPhone: string | undefined;
    if (vault.advisor_id) {
      const { data: advisorRow } = await supabase
        .from('advisors')
        .select('email, phone')
        .eq('id', vault.advisor_id)
        .maybeSingle();
      if (advisorRow?.email) advisorEmail = advisorRow.email;
      advisorPhone = advisorRow?.phone || undefined;
    }

    // Followers shadow the client — keep them CC'd like every other client email.
    const { data: followerRows } = await supabase
      .from('client_followers')
      .select('advisor_id, advisors(email)')
      .eq('client_vault_id', vault.id);
    const followerEmails = (followerRows || [])
      .map((row: any) => row.advisors?.email)
      .filter((e: any): e is string => typeof e === 'string' && e.includes('@'));

    const magicLink = await generateDocUploadMagicLink(vault.client_email);

    await send_speed_doc_request_email({
      client_name: vault.client_name,
      client_email: vault.client_email,
      company_name: vault.company_name,
      proposed_loan_type: vault.proposed_loan_type || '',
      capital_requested: Number(vault.capital_requested),
      requested_documents: docDefinitions.map(doc => doc.label),
      magic_link: magicLink || undefined,
      login_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io'}/auth/login`,
      advisor_name: vault.advisor_name || 'Your Advisor',
      advisor_email: advisorEmail,
      advisor_phone: advisorPhone,
      advisor_cc_email: advisorEmail,
      advisor_cc_emails: followerEmails,
    });
    console.log(`✅ Document request email sent to ${vault.client_email}`);
  } catch (emailErr) {
    console.error('⚠️ releaseSpeedFormDocs: document request email failed (non-fatal)', emailErr);
  }

  return { released: true };
}
