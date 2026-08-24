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

/**
 * Copy for a RE-submission: the file going back out to a lender that already
 * gave a verdict, usually carrying the extra documents or corrections that
 * lender asked for. Kept out of EVENT_COPY because it is not a pipeline status
 * of its own — the row lands back on 'submitted' either way.
 */
function resubmitSlackCopy(lender: string, company?: string): string {
  return `🔁 The file${company ? ` for ${company}` : ''} has been *re-submitted* to *${lender}* — awaiting a fresh decision.`;
}

// The note UW typed into the "Lender response" panel, labelled by verdict. Same
// wording as note_label() in components/lender/lender-response-panel.tsx so the
// Slack post and the UI call the same field the same thing.
//
// 'submitted' is deliberately absent. A response note on an outbound submission
// is ALWAYS stale — nothing has come back from the lender this round yet, and
// the only way the column is populated at that moment is a re-submission after
// a previous verdict. Republishing last round's decline reasons under "awaiting
// the lender's decision" read as though the lender had just said it again.
const NOTE_LABEL: Record<'approved_by_lender' | 'declined_by_lender', string> = {
  approved_by_lender: 'Offer / stips / requested documents',
  declined_by_lender: 'Decline reasons',
};

/** The events whose Slack post carries the recorded lender response. */
function isVerdict(event: LenderPipelineEvent): event is 'approved_by_lender' | 'declined_by_lender' {
  return event === 'approved_by_lender' || event === 'declined_by_lender';
}

// The note column caps at 5000 chars; clip well below that so one verbose
// decline can't bury the channel.
const NOTE_MAX = 1200;

/**
 * Renders the lender-response note as a Slack blockquote. Returns '' when there
 * is no note, so callers can concatenate it unconditionally.
 */
function formatNoteBlock(label: string, notes: string | null | undefined): string {
  const body = (notes ?? '').trim();
  if (!body) return '';
  const clipped = body.length > NOTE_MAX ? `${body.slice(0, NOTE_MAX)}…` : body;
  const quoted = clipped
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n');
  return `\n*${label}:*\n${quoted}`;
}

interface AssignmentRow {
  id: string;
  client_id: string;
  lender_name: string;
  specialty: string | null;
  /**
   * UW's typed note for this lender, if it already exists when the status
   * flips. Included in the Slack post so the channel gets the decline reasons /
   * offer terms in the same message as the verdict — not just the verdict.
   */
  response_notes?: string | null;
}

/**
 * Notify admins (in-app + email + Slack) of a lender pipeline event for one
 * assignment. Best-effort throughout; returns { notified, emailed } for logging.
 */
export async function notifyAdminsOfLenderPipelineEvent(
  assignment: AssignmentRow,
  event: LenderPipelineEvent,
  options?: {
    /**
     * True when this 'submitted' event is the file going BACK to a lender that
     * already responded once. Changes the Slack copy and the in-app title so a
     * reader can tell a second attempt from a first.
     */
    resubmission?: boolean;
    /** What UW changed for this round — the one thing worth reading. */
    resubmit_note?: string | null;
  }
): Promise<{ notified: number; emailed: number }> {
  const { client_id, lender_name, specialty } = assignment;
  if (!client_id) return { notified: 0, emailed: 0 };

  const is_resubmission = event === 'submitted' && options?.resubmission === true;

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
        title: is_resubmission ? `Re-submitted to ${lender_name}` : copy.title(lender_name),
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
      // A re-submission reuses the 'submitted' template on purpose: the fact an
      // admin needs from the email is that the file is out and awaiting a
      // decision, which is identical either way. Slack is where the second
      // attempt is distinguished, because that is where the team works it.
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
      // No vault link on these posts. A file goes out to several lenders at
      // once, so the verdict posts stack up and every one repeating the same
      // client URL spammed the channel. The link now rides only on the
      // note-recorded follow-up (decline reasons / offer + stips) below --
      // the post someone actually opens the file from.
      const mentions = formatMentions([...getApproverUserIds(), resolveAdvisorSlackId(advisor_email)]);

      const headline = is_resubmission
        ? resubmitSlackCopy(lender_label, company_name)
        : copy.slack(lender_label, company_name);

      // Only a verdict carries the recorded lender response. A re-submission
      // carries what UW changed instead — the previous round's response is
      // history by then, and repeating it here is the bug this replaced.
      const note_block = is_resubmission
        ? formatNoteBlock('What changed this round', options?.resubmit_note)
        : isVerdict(event)
          ? formatNoteBlock(NOTE_LABEL[event], assignment.response_notes)
          : '';

      await slackPostMessage(slack_channel_id, `${mentions ? mentions + ' ' : ''}${headline}${note_block}`);
    }
  } catch (err) {
    console.error('notifyAdminsOfLenderPipelineEvent Slack error (non-fatal):', err);
  }

  return { notified, emailed };
}

/**
 * Slack follow-up for a note typed AFTER the status was already flipped — the
 * normal UW order of operations (mark declined, then expand the panel and type
 * why). Without this the channel would only ever see the bare verdict, since
 * notifyAdminsOfLenderPipelineEvent fires before the note exists.
 *
 * Deliberately quiet: no @-mentions (the verdict post already pinged everyone),
 * and callers only invoke it the FIRST time a note is recorded, so later typo
 * fixes don't re-post. Best-effort — never throws.
 */
export async function notifyLenderResponseNoteRecorded(
  assignment_id: string,
  notes: string
): Promise<void> {
  const body = (notes ?? '').trim();
  if (!body) return;

  try {
    const { data: assignment } = await supabase_admin
      .from('client_lender_assignments')
      .select('client_id, lender_name, specialty, status')
      .eq('id', assignment_id)
      .maybeSingle();

    const status = (assignment as any)?.status as LenderPipelineEvent | undefined;
    const client_id = (assignment as any)?.client_id as string | undefined;
    // Only lender verdicts are worth announcing; a note on a still-awaiting
    // row is UW scratch work.
    if (!client_id || (status !== 'approved_by_lender' && status !== 'declined_by_lender')) return;

    const { data: client_row } = await supabase_admin
      .from('client_data_vault')
      .select('company_name, slack_channel_id')
      .eq('id', client_id)
      .maybeSingle();

    const channel_id = (client_row as any)?.slack_channel_id as string | null;
    if (!channel_id) return;

    const company_name = (client_row as any)?.company_name as string | undefined;
    const lender_label = `${(assignment as any).lender_name}${
      (assignment as any).specialty ? ` (${(assignment as any).specialty})` : ''
    }`;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io';
    const headline =
      status === 'declined_by_lender'
        ? `📝 Decline reasons recorded for *${lender_label}*${company_name ? ` — ${company_name}` : ''}.`
        : `📝 Offer / stips recorded for *${lender_label}*${company_name ? ` — ${company_name}` : ''}.`;

    await slackPostMessage(
      channel_id,
      `${headline}${formatNoteBlock(NOTE_LABEL[status], body)}\n${baseUrl}/admin/clients/${client_id}`
    );
  } catch (err) {
    console.error('notifyLenderResponseNoteRecorded error (non-fatal):', err);
  }
}

/**
 * Slack-only announcement that the deal FUNDED, posted into the deal channel.
 *
 * The funded event was the one hole in the lender lifecycle's Slack coverage:
 * submitted / approved / declined all post, but funding — the outcome the
 * channel exists for — only ever reached GHL, the advisor's inbox, and the
 * pipeline. The channel where the file was actually worked heard nothing.
 *
 * Slack-only on purpose: fundLoanAction already emails the advisor and fires
 * the in-app notification, so routing this through
 * notifyAdminsOfLenderPipelineEvent would double up on both.
 *
 * Best-effort — never throws. Funding must never fail because Slack did.
 */
export async function notifyDealFundedToSlack(
  client_id: string,
  details: {
    lender_name?: string | null;
    amount_funded?: string | null;
    term?: string | null;
    amount_requested?: string | number | null;
    sales_rep?: string | null;
  }
): Promise<void> {
  if (!client_id) return;

  try {
    const { data: client_row } = await supabase_admin
      .from('client_data_vault')
      .select('company_name, client_name, slack_channel_id, advisors(email)')
      .eq('id', client_id)
      .maybeSingle();

    const channel_id = (client_row as any)?.slack_channel_id as string | null;
    if (!channel_id) return;

    const company_name =
      (client_row as any)?.company_name || (client_row as any)?.client_name || 'this file';
    const adv: any = Array.isArray((client_row as any)?.advisors)
      ? (client_row as any).advisors[0]
      : (client_row as any)?.advisors;
    const mentions = formatMentions([
      ...getApproverUserIds(),
      resolveAdvisorSlackId(adv?.email ?? null),
    ]);

    // Only the figures we actually have. A funded post padded with "—" reads
    // like the deal was recorded with details missing.
    const lines: string[] = [];
    if (details.amount_funded) lines.push(`• Amount funded: *${details.amount_funded}*`);
    if (details.amount_requested) lines.push(`• Originally requested: ${details.amount_requested}`);
    if (details.term) lines.push(`• Term: ${details.term}`);
    if (details.sales_rep) lines.push(`• Sales rep: ${details.sales_rep}`);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io';
    const headline = details.lender_name
      ? `🎉 *FUNDED* — ${company_name} funded by *${details.lender_name}*.`
      : `🎉 *FUNDED* — ${company_name}.`;

    await slackPostMessage(
      channel_id,
      `${mentions ? mentions + ' ' : ''}${headline}` +
        `${lines.length ? `\n${lines.join('\n')}` : ''}\n` +
        `${baseUrl}/admin/clients/${client_id}`
    );
  } catch (err) {
    console.error('notifyDealFundedToSlack error (non-fatal):', err);
  }
}
