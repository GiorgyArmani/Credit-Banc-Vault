// src/app/api/slack/send-bank-analysis/route.ts
//
// POST /api/slack/send-bank-analysis   (multipart/form-data)
//   fields: client_id, message, filename, file (the rendered PDF)
//
//   Posts the bank-analysis summary + its PDF into the deal's Slack channel as a
//   single message. Replaces the manual copy/paste-and-drag the UW team does today.
//
// The PDF is rendered in the BROWSER and uploaded here rather than re-rendered
// server-side on purpose: the analyst's unsaved edits (notes, per-account range
// overrides, positions typed but not yet saved) live only in component state, so
// a server-side render would silently ship a different document than the one the
// Export PDF button produces.
//
// AuthZ: admin OR underwriting (requireStaff).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireStaff } from '@/lib/auth/require-staff';
import { slackUploadFile } from '@/lib/slack-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Guardrail so a malformed client upload can't push an arbitrarily large body
 *  through the function. A 12-period bank analysis PDF runs well under 1 MB. */
const MAX_PDF_BYTES = 10 * 1024 * 1024;

const supabase_admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(request: Request) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const form = await request.formData();
    const client_id = String(form.get('client_id') || '');
    const message = String(form.get('message') || '').trim();
    const file = form.get('file');

    if (!client_id) {
      return NextResponse.json({ error: 'Missing client_id.' }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ error: 'Missing message.' }, { status: 400 });
    }
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Missing PDF file.' }, { status: 400 });
    }

    const bytes = Buffer.from(await (file as File).arrayBuffer());
    if (bytes.byteLength === 0) {
      return NextResponse.json({ error: 'PDF file is empty.' }, { status: 400 });
    }
    if (bytes.byteLength > MAX_PDF_BYTES) {
      return NextResponse.json({ error: 'PDF is too large to post to Slack.' }, { status: 413 });
    }

    // Slack rejects odd filenames; keep it to a safe charset and always .pdf.
    const rawName = String(form.get('filename') || 'bank-analysis.pdf');
    const filename =
      rawName.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+/, '').slice(0, 100) ||
      'bank-analysis.pdf';

    // Resolve the deal channel. No channel → nothing to post to; tell the caller
    // to create it from the UW client page rather than creating one here (that
    // flow invites the right people and sets the purpose block).
    const { data: client, error: client_error } = await supabase_admin
      .from('client_data_vault')
      .select('id, company_name, slack_channel_id, slack_channel_name')
      .eq('id', client_id)
      .maybeSingle();

    if (client_error) {
      console.error('slack send-bank-analysis client lookup error:', client_error);
      return NextResponse.json({ error: 'Lookup failed.' }, { status: 500 });
    }
    if (!client) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
    }
    if (!client.slack_channel_id) {
      return NextResponse.json(
        {
          error:
            'This deal has no Slack channel yet. Create it from the underwriting client page first.',
          code: 'no_channel',
        },
        { status: 409 }
      );
    }

    try {
      await slackUploadFile({
        channelId: client.slack_channel_id,
        filename: filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`,
        bytes,
        title: `${client.company_name || 'Client'} — Bank Analysis`,
        comment: message,
      });
    } catch (err: any) {
      console.error('slackUploadFile error:', err);
      return NextResponse.json(
        { error: `Slack upload failed: ${err?.message || 'unknown'}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      channel_id: client.slack_channel_id,
      channel_name: client.slack_channel_name,
    });
  } catch (err: any) {
    console.error('slack send-bank-analysis error:', err);
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}
