import { describe, expect, it } from "vitest";
import {
  getClientFileCapabilities,
  getClientFilePortal,
  type ClientFilePortal,
} from "@/components/client-file/capabilities";

describe("getClientFilePortal", () => {
  it.each([
    ["/admin", "admin"],
    ["/admin/uw", "admin"],
    ["/underwriting/dashboard", "underwriting"],
    ["/partner", "partner"],
    ["/desk", "partner"],
    ["/advisor/dashboard", "advisor"],
    ["", "advisor"],
  ])("%s → %s", (basePath, portal) => {
    expect(getClientFilePortal(basePath)).toBe(portal);
  });
});

describe("getClientFileCapabilities", () => {
  const caps = (p: ClientFilePortal) => getClientFileCapabilities(p);

  it("advisor and partner never get review or lenders", () => {
    for (const p of ["advisor", "partner"] as const) {
      expect(caps(p).tabs).toEqual(["overview", "documents", "notes"]);
    }
  });

  it("underwriting and admin get every tab", () => {
    for (const p of ["underwriting", "admin"] as const) {
      expect(caps(p).tabs).toEqual(["overview", "documents", "review", "lenders", "notes"]);
    }
  });

  it("primary action is submit for advisor/partner and funded for uw/admin", () => {
    expect(caps("advisor").headerActions.at(-1)).toBe("submit_to_uw");
    expect(caps("partner").headerActions.at(-1)).toBe("submit_to_uw");
    expect(caps("underwriting").headerActions.at(-1)).toBe("funded");
    expect(caps("admin").headerActions.at(-1)).toBe("funded");
  });

  it("partner and advisor never get share-with-lender; the referral partner picker stays advisor-only", () => {
    expect(caps("partner").headerActions).not.toContain("share_with_lender");
    expect(caps("partner").showReferralPartner).toBe(false);
    expect(caps("advisor").headerActions).not.toContain("share_with_lender");
    expect(caps("advisor").showReferralPartner).toBe(true);
    expect(caps("admin").headerActions).toContain("share_with_lender");
  });

  it("only admin reassigns or starts rounds", () => {
    for (const p of ["advisor", "partner", "underwriting"] as const) {
      expect(caps(p).menuItems).not.toContain("reassign_advisor");
      expect(caps(p).menuItems).not.toContain("start_round");
      expect(caps(p).canReassignAdvisor).toBe(false);
    }
    expect(caps("admin").menuItems).toEqual(expect.arrayContaining(["reassign_advisor", "start_round"]));
    expect(caps("admin").canReassignAdvisor).toBe(true);
  });

  it("every workspace portal keeps delete vault; underwriting does not have it", () => {
    for (const p of ["advisor", "partner", "admin"] as const) {
      expect(caps(p).menuItems).toContain("delete_vault");
    }
    expect(caps("underwriting").menuItems).not.toContain("delete_vault");
  });

  it("stage ceiling is documents_received (3) for advisor/partner and uncapped otherwise", () => {
    expect(caps("advisor").stageCeilingIndex).toBe(3);
    expect(caps("partner").stageCeilingIndex).toBe(3);
    expect(caps("underwriting").stageCeilingIndex).toBeNull();
    expect(caps("admin").stageCeilingIndex).toBeNull();
  });

  it("decline, slack and notify are uw/admin only", () => {
    for (const p of ["advisor", "partner"] as const) {
      expect(caps(p).headerActions).not.toEqual(expect.arrayContaining(["decline"]));
      expect(caps(p).headerActions).not.toContain("slack");
      expect(caps(p).headerActions).not.toContain("notify_advisor");
    }
    for (const p of ["underwriting", "admin"] as const) {
      expect(caps(p).headerActions).toEqual(expect.arrayContaining(["notify_advisor", "slack", "decline"]));
    }
  });

  it("lender tile is uw/admin only", () => {
    expect(caps("advisor").showLenderTile).toBe(false);
    expect(caps("partner").showLenderTile).toBe(false);
    expect(caps("underwriting").showLenderTile).toBe(true);
    expect(caps("admin").showLenderTile).toBe(true);
  });

  it("every workspace portal includes submit_to_uw in headerActions; underwriting does not", () => {
    for (const p of ["advisor", "partner", "admin"] as const) {
      expect(caps(p).headerActions).toContain("submit_to_uw");
    }
    expect(caps("underwriting").headerActions).not.toContain("submit_to_uw");
  });

  it("returns fresh arrays so callers cannot mutate the matrix", () => {
    caps("advisor").tabs.push("review");
    expect(caps("advisor").tabs).not.toContain("review");
  });

  it("underwriting and admin can decide documents; advisor and partner cannot", () => {
    expect(caps("underwriting").canDecideDocuments).toBe(true);
    expect(caps("admin").canDecideDocuments).toBe(true);
    expect(caps("advisor").canDecideDocuments).toBe(false);
    expect(caps("partner").canDecideDocuments).toBe(false);
  });

  it("underwriting's menu carries the packet tools and no client-account items", () => {
    const menu = caps("underwriting").menuItems;
    expect(menu).toEqual([
      "add_doc_type",
      "upload_for_client",
      "upload_funding_app",
      "zip_packet",
      "archive_slack",
    ]);
    expect(menu).not.toContain("edit_profile");
    expect(menu).not.toContain("delete_vault");
  });

  it("underwriting's menu does not duplicate LenderPanel's own toolbar tools", () => {
    const menu = caps("underwriting").menuItems;
    expect(menu).not.toContain("bank_analysis");
    expect(menu).not.toContain("match_tool");
  });

  it("admin keeps its client-account items and also gets the packet tools", () => {
    const menu = caps("admin").menuItems;
    expect(menu).toEqual(expect.arrayContaining(["edit_profile", "delete_vault", "reassign_advisor"]));
    expect(menu).toEqual(expect.arrayContaining(["add_doc_type", "bank_analysis", "match_tool", "zip_packet"]));
  });
});
