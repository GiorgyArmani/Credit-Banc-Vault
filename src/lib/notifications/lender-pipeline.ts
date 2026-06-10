// src/lib/notifications/lender-pipeline.ts
//
// Shared admin notifier for the post-admin-review lender lifecycle. Fired when
// a single lender assignment changes pipeline status:
//   • 'submitted'          — UW pushed the file out to the lender.
//   • 'approved_by_lender' — the lender approved the submission.
//   • 'declined_by_lender' — the lender declined the submission.
//
// Fans out to admins via in-app notifications + a single email, and posts into
// the deal's Slack channel if one exists. Every channel is best-effort: a
// failure in one never blocks the others, and nothing thrown here should ever
// fail the status transition that triggered it — callers run this fire-and-forget.
//
// Server-only (uses the service-role key). Not a "use server" action — it is
// called from API route handlers, not the client.

import { createClient } from '@supabase/supabase-js';
import { send_lender_pipeline_notification, type LenderPipelineEvent } from '@/lib/email';
import { slackPostMessage, getApproverUserIds, resolveAdvisorSlackId, formatMentions } from '@/lib/slack-api';

const supabase_admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const EVENT_COPY: Record<LenderPipelineEvent, { title: (lender: string) => string; slack: (lender: string, company?: string) => string }> = {
  submitted: {
    title: (lender) => `Submitted to ${lender}`,
    slack: (lender, company) =>
      `📤 The file${company ? ` for ${company}` : ''} has been submitted to *${lender}* — awaiting the lender's decision.`,
  },
  approved_by_lender: {
    title: (lender) => `${lender} approved the submission`,
    slack: (lender, company) =>
      `✅ *${lender}* has *approved* the submission${company ? ` for ${company}` : ''}.`,
  },
  declined_by_lender: {
    title: (lender) => `${lender} declined the submission`,
    slack: (lender, company) =>
      `❌ *${lender}* has *declined* the submission${company ? ` for ${company}` : ''}.`,
  },
};

interface AssignmentRow {
  id: string;
  client_id: string;
  lender_name: string;
  specialty: string | null;
}

/**
 * Notify admins (in-app + email + Slack) of a lender pipeline event for one
 * assignment. Best-effort throughout; returns { notified, emailed } for logging.
 */
export async function notifyAdminsOfLenderPipelineEvent(
  assignment: AssignmentRow,
  event: LenderPipelineEvent
): Promise<{ notified: number; emailed: number }> {
  const { client_id, lender_name, specialty } = assignment;
  if (!client_id) return { notified: 0, emailed: 0 };

  let admin_users: { id: string; email: string }[] = [];
  let client_name = 'a client';
  let company_name: string | undefined;
  let slack_channel_id: string | null = null;
  let advisor_email: string | null = null;

  try {
    const [{ data: admins }, { data: client_row }] = await Promise.all([
      supabase_admin.from('users').select('id, email').eq('role', 'admin'),
      supabase_admin
        .from('client_data_vault')
        .select('client_name, company_name, slack_channel_id, advisors(email)')
        .eq('id', client_id)
        .maybeSingle(),
    ]);

    admin_users = (admins ?? []) as { id: string; email: string }[];
    client_name = client_row?.client_name || client_row?.company_name || 'a client';
    company_name = client_row?.company_name ?? undefined;
    slack_channel_id = (client_row as any)?.slack_channel_id ?? null;
    const adv: any = Array.isArray((client_row as any)?.advisors)
      ? (client_row as any).advisors[0]
      : (client_row as any)?.advisors;
    advisor_email = adv?.email ?? null;
  } catch (err) {
    console.error('notifyAdminsOfLenderPipelineEvent: failed to load admins/client:', err);
    return { notified: 0, emailed: 0 };
  }

  const copy = EVENT_COPY[event];
  const lender_label = `${lender_name}${specialty ? ` (${specialty})` : ''}`;

  // ── In-app: one row per admin (service role → bypasses RLS). ──────────────
  let notified = 0;
  try {
    if (admin_users.length > 0) {
      const rows = admin_users.map((u) => ({
        user_id: u.id,
        client_id,
        title: copy.title(lender_name),
        message: `${lender_label} — ${client_name}`,
        is_read: false,
      }));
      const { error: insert_err } = await supabase_admin.from('in_app_notifications').insert(rows);
      if (insert_err) {
        console.error('notifyAdminsOfLenderPipelineEvent in-app insert error:', insert_err);
      } else {
        notified = admin_users.length;
      }
    }
  } catch (err) {
    console.error('notifyAdminsOfLenderPipelineEvent in-app exception:', err);
  }

  // ── Email: one message to all admins at once. ─────────────────────────────
  let emailed = 0;
  try {
    const admin_emails = admin_users
      .map((u) => u.email)
      .filter((e): e is string => !!e && e.includes('@'));

    if (admin_emails.length > 0) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io';
      await send_lender_pipeline_notification({
        admin_emails,
        event,
        client_name,
        company_name,
        lender_name,
        specialty,
        client_profile_url: `${baseUrl}/admin/clients/${client_id}`,
      });
      emailed = admin_emails.length;
    }
  } catch (err) {
    console.error('notifyAdminsOfLenderPipelineEvent email error (non-fatal):', err);
  }

  // ── Slack: post into the deal channel (if one exists). ────────────────────
  try {
    if (slack_channel_id) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io';
      const mentions = formatMentions([...getApproverUserIds(), resolveAdvisorSlackId(advisor_email)]);
      const text =
        `${mentions ? mentions + ' ' : ''}${copy.slack(lender_label, company_name)}\n` +
        `${baseUrl}/admin/clients/${client_id}`;
      await slackPostMessage(slack_channel_id, text);
    }
  } catch (err) {
    console.error('notifyAdminsOfLenderPipelineEvent Slack error (non-fatal):', err);
  }

  return { notified, emailed };
}
