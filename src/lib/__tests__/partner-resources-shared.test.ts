// src/lib/__tests__/partner-resources-shared.test.ts
import { describe, it, expect } from "vitest";
import {
  MAX_RESOURCE_BYTES,
  formatFileSize,
  resourceExtension,
  resourceMimeType,
  resourceStoragePath,
  titleFromFileName,
  validateResourceFields,
  validateResourceFile,
} from "@/lib/partner-resources-shared";

const ID = "3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b";

describe("resourceExtension / resourceMimeType", () => {
  it("reads the extension case-insensitively", () => {
    expect(resourceExtension("Rate Sheet.PDF")).toBe("pdf");
    expect(resourceMimeType("Rate Sheet.PDF")).toBe("application/pdf");
  });
  it("rejects types outside the list", () => {
    expect(resourceExtension("page.html")).toBeNull();
    expect(resourceExtension("logo.svg")).toBeNull();
    expect(resourceExtension("archive.zip")).toBeNull();
    expect(resourceExtension("no-extension")).toBeNull();
    expect(resourceMimeType("run.exe")).toBeNull();
  });
  it("only looks at the last extension", () => {
    expect(resourceExtension("invoice.pdf.exe")).toBeNull();
  });
});

describe("validateResourceFile", () => {
  it("accepts a normal document", () => {
    expect(validateResourceFile({ name: "guide.docx", size: 1234 })).toBeNull();
  });
  it("rejects unsupported, empty and oversized files", () => {
    expect(validateResourceFile({ name: "movie.mp4", size: 10 })).toMatch(/isn't supported/);
    expect(validateResourceFile({ name: "a.pdf", size: 0 })).toMatch(/empty/);
    expect(validateResourceFile({ name: "a.pdf", size: MAX_RESOURCE_BYTES + 1 })).toMatch(/50 MB/);
  });
  it("rejects an over-long file name", () => {
    expect(validateResourceFile({ name: `${"a".repeat(250)}.pdf`, size: 10 })).toMatch(/too long/);
  });
});

describe("resourceStoragePath", () => {
  it("puts the sanitised name under the id folder", () => {
    expect(resourceStoragePath(ID, "Rate Sheet (Q4).pdf")).toBe(`${ID}/Rate_Sheet_Q4_.pdf`);
  });
  it("can't escape the id folder", () => {
    const path = resourceStoragePath(ID, "../../users/secret.pdf");
    expect(path.startsWith(`${ID}/`)).toBe(true);
    expect(path.slice(ID.length + 1)).not.toContain("/");
  });
  it("keeps the extension when a long name is trimmed", () => {
    const path = resourceStoragePath(ID, `${"a".repeat(190)}.xlsx`);
    expect(path.endsWith(".xlsx")).toBe(true);
    expect(path.length).toBe(ID.length + 1 + 120);
  });
});

describe("validateResourceFields", () => {
  it("trims and nulls an empty description", () => {
    expect(validateResourceFields({ title: "  Guide  ", description: "  " })).toEqual({
      ok: true,
      value: { title: "Guide", description: null },
    });
  });
  it("requires a title", () => {
    expect(validateResourceFields({ title: "   " }).ok).toBe(false);
    expect(validateResourceFields({ title: 42 }).ok).toBe(false);
  });
});

describe("display helpers", () => {
  it("derives a title from the file name", () => {
    expect(titleFromFileName("Partner Playbook v2.pdf")).toBe("Partner Playbook v2");
  });
  it("formats sizes in KB and MB", () => {
    expect(formatFileSize(300)).toBe("1 KB");
    expect(formatFileSize(350 * 1024)).toBe("350 KB");
    expect(formatFileSize(5.5 * 1024 * 1024)).toBe("5.5 MB");
  });
});
