// src/lib/partner-resources.ts
//
// Server-only reads for the referral partner resource library. The table is
// RLS-locked with zero policies and the bucket is private, so everything goes
// through the service role — callers MUST have checked the viewer's role first
// (the /partner and /admin layouts do; the download route checks for itself).

import { createAdminClient } from "@/lib/supabase/admin";
import type { PartnerResourceRow } from "@/lib/partner-resources-shared";

const RESOURCE_COLUMNS =
  "id, title, description, file_name, mime_type, size_bytes, is_published, created_at";

export type ResourceListing = {
  resources: PartnerResourceRow[];
  /** The library couldn't be read — show "try again", never the empty state. */
  degraded: boolean;
};

async function list(onlyPublished: boolean): Promise<ResourceListing> {
  let q = createAdminClient()
    .from("partner_resources")
    .select(RESOURCE_COLUMNS)
    .order("created_at", { ascending: false });
  if (onlyPublished) q = q.eq("is_published", true);
  const { data, error } = await q;
  if (error) {
    console.error("partner-resources: list failed:", error);
    return { resources: [], degraded: true };
  }
  return { resources: (data ?? []) as PartnerResourceRow[], degraded: false };
}

export function listPublishedResources(): Promise<ResourceListing> {
  return list(true);
}

export function listAllResources(): Promise<ResourceListing> {
  return list(false);
}
