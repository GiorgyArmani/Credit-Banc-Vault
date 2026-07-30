// src/lib/slack-api.ts
//
// Slack integration for UW deal channels. One token: SLACK_BOT_TOKEN (xoxb,
// scopes channels:manage + chat:write + chat:write.public). The bot creates the
// channel, so it is already a member and can post without being invited.
//
// This deliberately avoids the admin.conversations.* API. Those methods require
// the installing user to be an Enterprise Grid Org Owner/Admin — ours is not, and
// every admin.* call came back `restricted_action`. The bot-scoped equivalents
// need no org-admin role. Do not "upgrade" back to admin.* without checking that.
//
// SLACK_TEAM_ID is still required: the app is an org-wide install
// (is_enterprise_install: true), so conversations.create needs to be told which
// workspace to create the channel in.
//
// All calls hit the Slack Web API (https://slack.com/api/<method>) and return a
// JSON envelope shaped { ok: boolean, error?: string, ... }. `handle()` unwraps it.

const BASE = "https://slack.com/api";

function botToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("Missing SLACK_BOT_TOKEN env");
  return token;
}

/** Unwraps Slack's { ok, error, ... } envelope. Throws on ok:false. */
async function handle(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} :: ${JSON.stringify(data)}`);
  if (!data?.ok) throw new Error(`Slack error: ${data?.error || "unknown"} :: ${JSON.stringify(data)}`);
  return data;
}

async function slackPost(method: string, token: string, body: Record<string, any>): Promise<any> {
  const res = await fetch(`${BASE}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return handle(res);
}

/**
 * Slack channel names must be lowercase, <= 80 chars, and contain only letters,
 * numbers, hyphens, and underscores. Turn a company name into a valid slug.
 */
export function slugifyChannelName(company: string): string {
  const slug = (company || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumerics → hyphen
    .replace(/-+/g, "-") // collapse repeats
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens
  // Cap at 76 to leave room for a collision suffix; fall back if empty.
  return (slug || "client-channel").slice(0, 76).replace(/-+$/g, "");
}

/** The channel description block shown in the user's spec. */
export function buildChannelDescription(d: {
  company: string;
  client: string;
  phone: string;
  email: string;
  rep: string;
}): string {
  return [
    `Company Name: ${d.company || "—"}`,
    `Client Name: ${d.client || "—"}`,
    `Phone: ${d.phone || "—"}`,
    `Email: ${d.email || "—"}`,
    `Rep: ${d.rep || "—"}`,
  ].join("\n");
}

/**
 * Creates a channel via conversations.create. Returns the new channel id.
 * `name` must already be slugified. Throws on Slack error (e.g. name_taken) so
 * the caller can retry with a suffix.
 *
 * Private channels would additionally need the `groups:write` bot scope, which
 * is not currently granted — isPrivate is left in place for when it is.
 */
export async function slackCreateChannel(opts: {
  name: string;
  description?: string;
  isPrivate?: boolean;
}): Promise<string> {
  // NEXT_PUBLIC_SLACK_TEAM_ID is the fallback so the workspace id can be defined
  // once and still be readable by the client component that builds the
  // "Open Slack Channel" deep link (which needs ?team= to resolve on Grid).
  const teamId = process.env.SLACK_TEAM_ID || process.env.NEXT_PUBLIC_SLACK_TEAM_ID;
  if (!teamId) throw new Error("Missing SLACK_TEAM_ID env");

  const data = await slackPost("conversations.create", botToken(), {
    name: opts.name,
    is_private: opts.isPrivate ?? false,
    team_id: teamId,
  });
  const channelId = data.channel?.id as string;

  // conversations.create takes no description field, so the info block goes on
  // the channel purpose in a second call. Non-fatal — a channel without its
  // purpose set is still usable.
  if (opts.description) {
    try {
      await slackPost("conversations.setPurpose", botToken(), {
        channel: channelId,
        purpose: opts.description,
      });
    } catch (err) {
      console.error("⚠️ conversations.setPurpose failed (non-fatal):", err);
    }
  }

  return channelId;
}

/**
 * Invites users to a channel via conversations.invite. Non-fatal: logs and
 * swallows errors (a bad/duplicate user id should not abort channel setup).
 *
 * Invited one id per call on purpose. conversations.invite rejects the entire
 * batch when any single id is bad, so one stale id in SLACK_ADVISOR_USER_IDS
 * would silently leave the whole UW team out of the channel.
 */
export async function slackInviteUsers(channelId: string, userIds: string[]): Promise<void> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  for (const id of ids) {
    try {
      await slackPost("conversations.invite", botToken(), {
        channel: channelId,
        users: id,
      });
    } catch (err) {
      console.error(`⚠️ slackInviteUsers failed for ${id} (non-fatal):`, err);
    }
  }
}

/**
 * Archives a channel via conversations.archive. The bot created the channel and
 * holds channels:manage, so no org-admin role is needed. Throws on Slack error
 * so the caller can surface it (e.g. already_archived, channel_not_found).
 */
export async function slackArchiveChannel(channelId: string): Promise<void> {
  await slackPost("conversations.archive", botToken(), { channel: channelId });
}

/**
 * Posts a message to a channel via chat.postMessage (bot token). Non-fatal:
 * logs and returns false on failure so notification side-effects never break
 * the calling flow.
 */
export async function slackPostMessage(channelId: string, text: string): Promise<boolean> {
  try {
    await slackPost("chat.postMessage", botToken(), {
      channel: channelId,
      text,
      unfurl_links: false,
    });
    return true;
  } catch (err) {
    console.error("⚠️ slackPostMessage failed (non-fatal):", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Env-driven recipient resolution
// ---------------------------------------------------------------------------

function parseIdList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

/** UW team member ids to invite to every deal channel. */
export function getUwUserIds(): string[] {
  return parseIdList(process.env.SLACK_UW_USER_IDS);
}

/** Approver (Matt/Luigi) ids — invited to the channel and @-mentioned. */
export function getApproverUserIds(): string[] {
  return parseIdList(process.env.SLACK_APPROVER_USER_IDS);
}

/**
 * Resolves a file advisor's Slack user id from the email→id JSON map in
 * SLACK_ADVISOR_USER_IDS. Returns null if unset, unparseable, or no match.
 */
export function resolveAdvisorSlackId(email: string | null | undefined): string | null {
  if (!email) return null;
  const raw = process.env.SLACK_ADVISOR_USER_IDS;
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    // Case-insensitive email lookup.
    const target = email.toLowerCase();
    for (const [k, v] of Object.entries(map)) {
      if (k.toLowerCase() === target) return v;
    }
    return null;
  } catch (err) {
    console.error("⚠️ SLACK_ADVISOR_USER_IDS is not valid JSON:", err);
    return null;
  }
}

/** Formats a list of Slack user ids as `<@U1> <@U2>` mention text. */
export function formatMentions(userIds: (string | null | undefined)[]): string {
  return Array.from(new Set(userIds.filter(Boolean) as string[]))
    .map(id => `<@${id}>`)
    .join(" ");
}
