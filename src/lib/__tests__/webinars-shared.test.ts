// src/lib/__tests__/webinars-shared.test.ts
import { describe, it, expect } from "vitest";
import {
  MAX_WEBINAR_BYTES,
  webinarVideoPath,
  webinarThumbnailPath,
  isWebinarId,
  validateWebinarFile,
  validateWebinarFields,
  formatSessionDate,
  formatBytes,
  describeUploadError,
} from "@/lib/webinars-shared";

const ID = "3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b";

describe("paths", () => {
  it("builds video and thumbnail paths from the id", () => {
    expect(webinarVideoPath(ID)).toBe(`videos/${ID}.mp4`);
    expect(webinarThumbnailPath(ID)).toBe(`thumbnails/${ID}.jpg`);
  });
});

describe("isWebinarId", () => {
  it("accepts a uuid", () => expect(isWebinarId(ID)).toBe(true));
  it("rejects path traversal and junk", () => {
    expect(isWebinarId("../users/x")).toBe(false);
    expect(isWebinarId("")).toBe(false);
    expect(isWebinarId(42)).toBe(false);
  });
});

describe("validateWebinarFile", () => {
  it("accepts an mp4 by MIME", () => {
    expect(validateWebinarFile({ name: "a.mp4", type: "video/mp4", size: 10 })).toBeNull();
  });
  it("accepts an mp4 by extension when the browser gives no MIME", () => {
    expect(validateWebinarFile({ name: "Zoom Recording.MP4", type: "", size: 10 })).toBeNull();
  });
  it("rejects a .mov", () => {
    expect(validateWebinarFile({ name: "a.mov", type: "video/quicktime", size: 10 })).toMatch(/MP4/);
  });
  it("rejects an empty file", () => {
    expect(validateWebinarFile({ name: "a.mp4", type: "video/mp4", size: 0 })).toMatch(/empty/i);
  });
  it("accepts exactly the max and rejects one byte over", () => {
    expect(validateWebinarFile({ name: "a.mp4", type: "video/mp4", size: MAX_WEBINAR_BYTES })).toBeNull();
    expect(
      validateWebinarFile({ name: "a.mp4", type: "video/mp4", size: MAX_WEBINAR_BYTES + 1 })
    ).toMatch(/2 GB/);
  });
});

describe("validateWebinarFields", () => {
  it("trims and normalizes", () => {
    const r = validateWebinarFields({ title: "  Q3 Lender Update  ", description: "  ", session_date: "" });
    expect(r).toEqual({ ok: true, value: { title: "Q3 Lender Update", description: null, session_date: null } });
  });
  it("requires a non-blank title", () => {
    expect(validateWebinarFields({ title: "   " })).toEqual({ ok: false, error: "Title is required." });
    expect(validateWebinarFields({ title: undefined })).toEqual({ ok: false, error: "Title is required." });
  });
  it("caps title length", () => {
    const r = validateWebinarFields({ title: "x".repeat(201) });
    expect(r.ok).toBe(false);
  });
  it("accepts a real date and rejects a malformed or impossible one", () => {
    expect(validateWebinarFields({ title: "t", session_date: "2026-10-14" }).ok).toBe(true);
    expect(validateWebinarFields({ title: "t", session_date: "10/14/2026" }).ok).toBe(false);
    expect(validateWebinarFields({ title: "t", session_date: "2026-02-30" }).ok).toBe(false);
  });
});

describe("formatSessionDate", () => {
  it("renders the calendar date typed, regardless of time zone", () => {
    expect(formatSessionDate("2026-10-14")).toBe("October 14, 2026");
    expect(formatSessionDate("2026-01-01")).toBe("January 1, 2026");
  });
  it("returns null for null", () => expect(formatSessionDate(null)).toBeNull());
});

describe("formatBytes", () => {
  it("formats MB and GB", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.50 GB");
  });
});

describe("describeUploadError", () => {
  it("names the Supabase setting on a 413", () => {
    expect(describeUploadError(new Error("tus: unexpected response ... response code: 413"))).toMatch(
      /file size limit/i
    );
    expect(describeUploadError(new Error("The object exceeded the maximum allowed size"))).toMatch(
      /file size limit/i
    );
  });
  it("explains an expired session on 401/403", () => {
    expect(describeUploadError(new Error("response code: 401"))).toMatch(/sign in again/i);
    // Uploads are single-request now: nothing to resume.
    expect(describeUploadError(new Error("response code: 401"))).not.toMatch(/resume/i);
  });
  it("flags a duplicate object", () => {
    expect(describeUploadError(new Error("response code: 409"))).toMatch(/already exists/i);
  });
  it("falls back to the raw message", () => {
    expect(describeUploadError(new Error("boom"))).toBe("Upload failed: boom");
    expect(describeUploadError("weird")).toBe("Upload failed: weird");
  });
});

describe("webinarUploadUrl", () => {
  it("targets the direct storage host for a standard project URL", async () => {
    const { webinarUploadUrl } = await import("@/lib/webinars-shared");
    expect(webinarUploadUrl("https://abcdefghijklmnop.supabase.co/", "videos/x.mp4")).toBe(
      "https://abcdefghijklmnop.storage.supabase.co/storage/v1/object/webinars/videos/x.mp4"
    );
  });
  it("keeps the given host for custom domains and local dev", async () => {
    const { webinarUploadUrl } = await import("@/lib/webinars-shared");
    expect(webinarUploadUrl("https://api.creditbanc.io", "videos/x.mp4")).toBe(
      "https://api.creditbanc.io/storage/v1/object/webinars/videos/x.mp4"
    );
    expect(webinarUploadUrl("http://127.0.0.1:54321", "videos/x.mp4")).toBe(
      "http://127.0.0.1:54321/storage/v1/object/webinars/videos/x.mp4"
    );
  });
});
