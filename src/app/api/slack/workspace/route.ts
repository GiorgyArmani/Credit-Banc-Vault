// src/app/api/slack/workspace/route.ts
//
// GET /api/slack/workspace → { team_id }
//
// Exists so the Slack workspace id stops being a NEXT_PUBLIC_ variable. The UW
// client page needs it to build the "Open Slack Channel" deep link (?team= is
// required for the channel to resolve on Enterprise Grid), and the only way a
// client component could read an env var was the NEXT_PUBLIC_ prefix — which
// inlines the value into the JavaScript bundle, where anyone can read it
// whether or not they can log in.
//
// The workspace id is an identifier, not a credential: no Slack API call
// accepts it in place of a token, and it is visible inside the very deep link
// this endpoint helps build. It is fenced off anyway, because it costs one
// small route to hand it only to signed-in staff instead of to the internet.
//
// AuthZ: admin OR underwriting (the roles that see the Slack controls at all).

import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth/require-staff';

export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireStaff();
  if (!gate.ok) return gate.response;

  // NEXT_PUBLIC_SLACK_TEAM_ID stays as a fallback so an environment that only
  // defines the old variable keeps working. Reading it HERE is server-side and
  // costs nothing; the exposure only ever came from the client bundle.
  const team_id = process.env.SLACK_TEAM_ID || process.env.NEXT_PUBLIC_SLACK_TEAM_ID || null;

  return NextResponse.json({ team_id });
}
