// src/app/api/slack/archive-channel/route.ts
//
// POST /api/slack/archive-channel  { client_id }
//   Archives the deal's Slack channel and clears slack_channel_id/name on
//   client_data_vault. Clearing the ids is deliberate: they are the idempotency
//   key for create-channel, and leaving them set would make the app believe a
//   live channel exists — later chat.postMessage calls would fail with
//   is_archived. Nulling them lets a renewal mint a fresh channel.
//
// AuthZ: admin OR underwriting (requireStaff).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireStaff } from '@/lib/auth/require-staff';
import { slackArchiveChannel } from '@/lib/slack-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase_admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(request: Request) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const { client_id } = await request.json();
    if (!client_id) {
      return NextResponse.json({ error: 'Missing client_id.' }, { status: 400 });
    }

    const { data: client, error: client_error } = await supabase_admin
      .from('client_data_vault')
      .select('id, slack_channel_id, slack_channel_name')
      .eq('id', client_id)
      .maybeSingle();

    if (client_error) {
      console.error('slack archive-channel client lookup error:', client_error);
      return NextResponse.json({ error: 'Lookup failed.' }, { status: 500 });
    }
    if (!client) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
    }
    if (!client.slack_channel_id) {
      return NextResponse.json({ error: 'This deal has no Slack channel.' }, { status: 400 });
    }

    // Errors that all mean "the vault can no longer manage this channel" —
    // someone archived it, deleted it, or removed the bot from it by hand. These
    // are not failures: the goal is to end up with no live channel on the record,
    // and there already isn't one. Fall through and clear the ids, otherwise the
    // deal page is stuck showing "Open Slack Channel" forever with no way back to
    // the create button.
    //
    // Codes verified against the live workspace, not just the docs: re-archiving
    // an archived channel returns not_in_channel, and an unknown channel id on an
    // org-wide install returns team_access_not_granted — neither is the
    // already_archived/channel_not_found the API reference implies.
    const UNREACHABLE = [
      'already_archived',
      'channel_not_found',
      'is_archived',
      'not_in_channel',
      'team_access_not_granted',
    ];

    let unreachable = false;
    try {
      await slackArchiveChannel(client.slack_channel_id);
    } catch (err: any) {
      const message = String(err?.message || '');
      unreachable = UNREACHABLE.some(code => message.includes(code));
      if (!unreachable) {
        console.error('slackArchiveChannel error:', err);
        return NextResponse.json(
          { error: `Slack channel archive failed: ${err?.message || 'unknown'}` },
          { status: 502 }
        );
      }
    }

    const { error: update_error } = await supabase_admin
      .from('client_data_vault')
      .update({ slack_channel_id: null, slack_channel_name: null })
      .eq('id', client_id);

    if (update_error) {
      // Archived in Slack but the ids are still on the record — surface it, or
      // the deal page keeps offering a link to a dead channel.
      console.error('slack archive-channel persist error:', update_error);
      return NextResponse.json(
        { error: 'Channel archived but failed to save. Please retry.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, unreachable });
  } catch (err: any) {
    console.error('slack archive-channel error:', err);
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}
