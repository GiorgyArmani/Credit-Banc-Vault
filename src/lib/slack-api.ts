// src/lib/slack-api.ts
//
// Slack Enterprise Grid integration for UW deal channels. Two token types:
//   - SLACK_ADMIN_TOKEN (xoxp, org-admin, admin.conversations:write/read) — creates
//     channels and invites members via the admin.* methods.
//   - SLACK_BOT_TOKEN (xoxb, chat:write) — posts messages. The bot must be a member
//     of the channel, so it is invited (SLACK_BOT_USER_ID) at creation time.
//
// All calls hit the Slack Web API (https://slack.com/api/<method>) and return a
// JSON envelope shaped { ok: boolean, error?: string, ... }. `handle()` unwraps it.

const BASE = "https://slack.com/api";

function adminToken(): string {
  const token = process.env.SLACK_ADMIN_TOKEN;
  if (!token) throw new Error("Missing SLACK_ADMIN_TOKEN env");
  return token;
}

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
 * Creates a channel via admin.conversations.create. Returns the new channel_id.
 * `name` must already be slugified. Throws on Slack error (e.g. name_taken) so
 * the caller can retry with a suffix.
 */
export async function slackCreateChannel(opts: {
  name: string;
  description?: string;
  isPrivate?: boolean;
}): Promise<string> {
  const teamId = process.env.SLACK_TEAM_ID;
  if (!teamId) throw new Error("Missing SLACK_TEAM_ID env");

  const data = await slackPost("admin.conversations.create", adminToken(), {
    name: opts.name,
    is_private: opts.isPrivate ?? false,
    team_id: teamId,
    description: opts.description ?? "",
  });
  return data.channel_id as string;
}

/**
 * Invites users to a channel via admin.conversations.invite. Non-fatal: logs and
 * swallows errors (a bad/duplicate user id should not abort channel setup).
 */
export async function slackInviteUsers(channelId: string, userIds: string[]): Promise<void> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return;
  try {
    await slackPost("admin.conversations.invite", adminToken(), {
      channel_id: channelId,
      user_ids: ids.join(","),
    });
  } catch (err) {
    console.error("⚠️ slackInviteUsers failed (non-fatal):", err);
  }
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
