// src/lib/lender-api/types.ts
//
// The contract between the generic lender-API engine and each lender module.
// The engine owns everything lender-agnostic (loading the deal, the review
// panel, vault write-back, documents + watermarking, the submissions table,
// verdict recording). A provider owns only: auth + HTTP, mapping our data to
// its payload, its dropdown vocabularies, its document tags, and reading its
// status responses. Adding a lender = implement LenderApiProvider + register it.

import type { ResolvedVaultFields, SourceVault, VaultField } from "./vault-fields";

export type ProviderId = "forward_financing";

export type AssignmentStatus =
  | "pending"
  | "submitted"
  | "approved_by_lender"
  | "declined_by_lender"
  | "funded";

export interface SourceAssignment {
  id: string;
  client_id: string;
  business_profile_id: string | null;
  funding_deal_id: string | null;
  lender_name: string;
  specialty: string | null;
  decision: string;
  admin_review: string;
  status: AssignmentStatus;
}

export interface SourceBusiness {
  id: string;
  /** The business the vault's own business columns (street, EIN, address) describe. */
  is_primary: boolean;
  business_name: string | null;
  company_name: string | null;
  legal_entity_type: string | null;
  industry: string | null;
  business_start_date: string | null;
  phone: string | null;
  company_city: string | null;
  company_state: string | null;
  company_zip_code: string | null;
  avg_monthly_deposits: number | null;
}

export interface SourceDeal {
  id: string;
  capital_requested: number | null;
  loan_purpose: string | null;
  file_synopsis: string | null;
}

export interface SourceAnalysis {
  avg_revenue: number | null;
  avg_monthly_deposits: number | null;
}

export interface SourcePosition {
  lender_name: string;
  current_balance: number | null;
  payment_amount: number | null;
  payment_frequency: string | null;
}

/** Everything a provider may map from. Identical for every provider. */
export interface LenderApiSource {
  assignment: SourceAssignment;
  vault: SourceVault;
  /** Normalized, address-parsed vault fields. `values.ssn` is real digits — server only. */
  resolved: ResolvedVaultFields;
  business: SourceBusiness | null;
  deal: SourceDeal | null;
  analysis: SourceAnalysis | null;
  openPositions: SourcePosition[];
}

/**
 * `field` is a VaultField (editable in the panel), `pick:<key>` (a provider
 * dropdown), or any other string (fix it in the client profile).
 */
export interface Gap {
  field: string;
  label: string;
  kind: "missing" | "invalid";
}

export interface PickDefinition {
  key: string;
  label: string;
  options: readonly string[];
  required: boolean;
}

export type Picks = Record<string, string | null | undefined>;

export interface BuiltApplication {
  payload: unknown;
  /** Safe to store: SSN reduced to last 4. */
  redacted: unknown;
  gaps: Gap[];
  /** The picks actually used (suggestions merged with UW choices). */
  effectivePicks: Record<string, string | null>;
}

export interface SubmittableDocument {
  id: string;
  file_name: string;
  label: string;
  doc_code: string;
  tags: string[];
  stampable: boolean;
  preselected: boolean;
}

export interface OutboundDocument {
  documentId: string;
  filename: string;
  url: string;
  docCode: string | null;
  stamped: boolean;
}

export interface OutboundDocumentResult {
  documentId: string;
  filename: string;
  stamped: boolean;
  accepted: boolean;
  /** The file can no longer be sent (missing, not allowed, deleted) — terminal, never retried. */
  unavailable?: boolean;
  error?: string;
}

export type NormalizedStatus =
  | { kind: "approved"; stage: string; note: string }
  | { kind: "declined"; stage: string; note: string }
  | { kind: "needs_info"; stage: string; note: string }
  | { kind: "in_progress"; stage: string };

export interface CreateApplicationResult {
  ok: boolean;
  externalId?: string;
  fieldErrors?: Record<string, string[]>;
  error?: string;
  /** The lender HTTP status, when known — lets the engine tell a rejection (4xx) from an uncertain failure (0/5xx). */
  status?: number;
}

export interface FetchStatusResult {
  ok: boolean;
  raw?: unknown;
  error?: string;
}

export interface LenderApiProvider {
  id: ProviderId;
  displayName: string;
  matchesLender(lenderName: string): boolean;
  isConfigured(): boolean;
  requiredVaultFields: readonly VaultField[];
  picks: readonly PickDefinition[];
  suggestPicks(source: LenderApiSource): Record<string, string | null>;
  buildApplication(source: LenderApiSource, picks: Picks, ctx: { referenceId: string }): BuiltApplication;
  tagsForDocCode(docCode: string | null): string[];
  createApplication(payload: unknown): Promise<CreateApplicationResult>;
  uploadDocuments(externalId: string, docs: OutboundDocument[]): Promise<OutboundDocumentResult[]>;
  fetchStatus(externalId: string): Promise<FetchStatusResult>;
  interpretStatus(raw: unknown): NormalizedStatus;
  webhook?: {
    verify(req: Request): Promise<boolean>;
    extractExternalId(body: unknown): string | null;
  };
}
