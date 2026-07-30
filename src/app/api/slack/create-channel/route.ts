// src/app/api/slack/create-channel/route.ts
//
// POST /api/slack/create-channel  { client_id }
//   Creates a dedicated Slack channel for a UW deal and persists its id on
//   client_data_vault. Idempotent — if a channel already exists for the client
//   it's returned as-is. Invites the UW team, the file's advisor, and the
//   approvers (Matt/Luigi).
//
// AuthZ: admin OR underwriting (requireStaff).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireStaff } from '@/lib/auth/require-staff';
import {
  slackCreateChannel,
  slackInviteUsers,
  slugifyChannelName,
  buildChannelDescription,
  getUwUserIds,
  getApproverUserIds,
  resolveAdvisorSlackId,
} from '@/lib/slack-api';

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

    // Load the file + its advisor (for the description block + advisor mention).
    const { data: client, error: client_error } = await supabase_admin
      .from('client_data_vault')
      .select(`
        id, company_name, client_name, client_phone, client_email, advisor_name,
        slack_channel_id, slack_channel_name,
        advisors ( first_name, last_name, email )
      `)
      .eq('id', client_id)
      .maybeSingle();

    if (client_error) {
      console.error('slack create-channel client lookup error:', client_error);
      return NextResponse.json({ error: 'Lookup failed.' }, { status: 500 });
    }
    if (!client) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
    }

    // Idempotent: already has a channel → return it.
    if (client.slack_channel_id) {
      return NextResponse.json({
        success: true,
        already_existed: true,
        channel_id: client.slack_channel_id,
        channel_name: client.slack_channel_name,
      });
    }

    const advisor: any = Array.isArray(client.advisors) ? client.advisors[0] : client.advisors;
    const advisor_email: string | null = advisor?.email ?? null;
    const rep_name =
      (advisor ? `${advisor.first_name ?? ''} ${advisor.last_name ?? ''}`.trim() : '') ||
      client.advisor_name ||
      'Unknown';

    const description = buildChannelDescription({
      company: client.company_name,
      client: client.client_name,
      phone: client.client_phone,
      email: client.client_email,
      rep: rep_name,
    });

    // Create the channel, retrying once with a short suffix on a name collision.
    const baseName = slugifyChannelName(client.company_name || `client-${client_id}`);
    let channelId: string;
    let channelName = baseName;
    try {
      channelId = await slackCreateChannel({ name: baseName, description });
    } catch (err: any) {
      if (String(err?.message || '').includes('name_taken')) {
        channelName = `${baseName.slice(0, 71)}-${String(client_id).slice(0, 4)}`;
        channelId = await slackCreateChannel({ name: channelName, description });
      } else {
        console.error('slackCreateChannel error:', err);
        return NextResponse.json(
          { error: `Slack channel creation failed: ${err?.message || 'unknown'}` },
          { status: 502 }
        );
      }
    }

    // Invite the UW team, approvers, and the file's advisor. The bot is the
    // channel creator, so it is already a member — inviting it would just
    // return cant_invite_self.
    const inviteIds = [
      ...getUwUserIds(),
      ...getApproverUserIds(),
      resolveAdvisorSlackId(advisor_email) || '',
    ];
    await slackInviteUsers(channelId, inviteIds);

    // Persist on the vault record.
    const { error: update_error } = await supabase_admin
      .from('client_data_vault')
      .update({ slack_channel_id: channelId, slack_channel_name: channelName })
      .eq('id', client_id);

    if (update_error) {
      // Channel exists in Slack but we failed to persist — surface it so the
      // user can retry (the idempotency check keys off the stored id).
      console.error('slack create-channel persist error:', update_error);
      return NextResponse.json(
        { error: 'Channel created but failed to save. Please retry.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      channel_id: channelId,
      channel_name: channelName,
    });
  } catch (err: any) {
    console.error('slack create-channel error:', err);
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}
