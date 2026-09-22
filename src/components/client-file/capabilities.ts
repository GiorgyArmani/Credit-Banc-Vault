// The single source of "who sees what" on the client file. Every portal that
// renders a client file asks this module which tabs, header actions and menu
// items to show instead of sniffing basePath inline. It is a UI matrix, not a
// permission check: every underlying action re-checks the role server-side.
//
// Spec: docs/superpowers/specs/2026-09-17-client-file-redesign-design.md §2

export type ClientFilePortal = "advisor" | "partner" | "underwriting" | "admin";

export const CLIENT_FILE_TABS = ["overview", "documents", "review", "lenders", "notes"] as const;
export type ClientFileTab = (typeof CLIENT_FILE_TABS)[number];

export type HeaderActionId =
  | "request_docs"
  | "share_with_lender"
  | "notify_advisor"
  | "slack"
  | "decline"
  | "submit_to_uw"
  | "funded";

export type MenuItemId =
  | "edit_profile"
  | "copy_magic_link"
  | "resend_credentials"
  | "send_password_reset"
  | "add_funding_app"
  | "add_business"
  | "upload_for_client"
  | "start_round"
  | "reassign_advisor"
  | "archive_slack"
  | "delete_vault"
  // Packet tools: only the underwriting and admin surfaces wire these up.
  | "add_doc_type"
  | "upload_funding_app"
  | "zip_packet"
  | "bank_analysis"
  | "match_tool";

export interface ClientFileCapabilities {
  portal: ClientFilePortal;
  tabs: ClientFileTab[];
  /** Rendered in order; the LAST one is styled as the primary button. */
  headerActions: HeaderActionId[];
  menuItems: MenuItemId[];
  /** Highest pipeline step index the one-click advance may reach; null = no cap. */
  stageCeilingIndex: number | null;
  showLenderTile: boolean;
  showReferralPartner: boolean;
  canManageBusinesses: boolean;
  canReassignAdvisor: boolean;
  /** Review tab's Approve/Reject; true for underwriting and admin only. */
  canDecideDocuments: boolean;
}

export function getClientFilePortal(basePath: string): ClientFilePortal {
  if (basePath.startsWith("/admin")) return "admin";
  if (basePath.startsWith("/underwriting")) return "underwriting";
  if (basePath.startsWith("/partner") || basePath.startsWith("/desk")) return "partner";
  return "advisor";
}

const CLIENT_ACCOUNT_MENU: MenuItemId[] = [
  "edit_profile",
  "copy_magic_link",
  "resend_credentials",
  "send_password_reset",
  "add_funding_app",
  "add_business",
];

const MATRIX: Record<ClientFilePortal, Omit<ClientFileCapabilities, "portal">> = {
  advisor: {
    tabs: ["overview", "documents", "notes"],
    // No share_with_lender: /api/share-links only admits admin + underwriting
    // server-side, so an advisor-visible button would be a dead end.
    headerActions: ["request_docs", "submit_to_uw"],
    menuItems: [...CLIENT_ACCOUNT_MENU, "delete_vault"],
    stageCeilingIndex: 3,
    showLenderTile: false,
    showReferralPartner: true,
    canManageBusinesses: true,
    canReassignAdvisor: false,
    canDecideDocuments: false,
  },
  partner: {
    tabs: ["overview", "documents", "notes"],
    headerActions: ["request_docs", "submit_to_uw"],
    menuItems: [...CLIENT_ACCOUNT_MENU, "delete_vault"],
    stageCeilingIndex: 3,
    showLenderTile: false,
    showReferralPartner: false,
    canManageBusinesses: true,
    canReassignAdvisor: false,
    canDecideDocuments: false,
  },
  underwriting: {
    tabs: ["overview", "documents", "review", "lenders", "notes"],
    headerActions: ["notify_advisor", "slack", "decline", "funded"],
    // Packet tools are the UW packet-building menu; no client-account items
    // here since underwriting doesn't own the client account.
    // bank_analysis / match_tool are deliberately absent: LenderPanel's own
    // toolbar on the Lenders tab owns them, and duplicating them in the ⋯ menu
    // gave the same two tools two homes on one surface.
    menuItems: [
      "add_doc_type",
      "upload_for_client",
      "upload_funding_app",
      "zip_packet",
      "archive_slack",
    ],
    stageCeilingIndex: null,
    showLenderTile: true,
    showReferralPartner: false,
    canManageBusinesses: false,
    canReassignAdvisor: false,
    canDecideDocuments: true,
  },
  admin: {
    tabs: ["overview", "documents", "review", "lenders", "notes"],
    // Admin keeps submit-to-UW: the Documents tab no longer carries the submit CTA,
    // so this header action is admin's only path to submit the vault to underwriting.
    headerActions: ["request_docs", "share_with_lender", "submit_to_uw", "notify_advisor", "slack", "decline", "funded"],
    menuItems: [
      ...CLIENT_ACCOUNT_MENU,
      "upload_for_client",
      "start_round",
      "reassign_advisor",
      "archive_slack",
      "delete_vault",
      // Packet tools, appended after admin's existing ids. Admin keeps
      // bank_analysis/match_tool in the menu (its surface has no LenderPanel
      // toolbar of its own yet); underwriting drops them as duplicates.
      "add_doc_type",
      "upload_funding_app",
      "zip_packet",
      "bank_analysis",
      "match_tool",
    ],
    stageCeilingIndex: null,
    showLenderTile: true,
    showReferralPartner: true,
    canManageBusinesses: true,
    canReassignAdvisor: true,
    canDecideDocuments: true,
  },
};

export function getClientFileCapabilities(portal: ClientFilePortal): ClientFileCapabilities {
  const row = MATRIX[portal];
  return {
    portal,
    ...row,
    tabs: [...row.tabs],
    headerActions: [...row.headerActions],
    menuItems: [...row.menuItems],
  };
}
