// src/lib/__tests__/webinars.test.ts
import { describe, it, expect, vi } from "vitest";

// webinars.ts imports the service-role client at module load; stub it so the
// pure helper can be tested without env vars.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { attachPlaybackUrls } from "@/lib/webinars";
import type { WebinarRow } from "@/lib/webinars-shared";

function row(id: string, thumb: string | null): WebinarRow {
  return {
    id,
    title: `T ${id}`,
    description: null,
    session_date: null,
    video_path: `videos/${id}.mp4`,
    thumbnail_path: thumb,
    size_bytes: 10,
    is_published: true,
    created_at: "2026-10-14T00:00:00Z",
  };
}

describe("attachPlaybackUrls", () => {
  it("attaches video and thumbnail urls, keeping order", () => {
    const rows = [row("a", "thumbnails/a.jpg"), row("b", null)];
    const out = attachPlaybackUrls(
      rows,
      new Map([["videos/a.mp4", "https://v/a"], ["videos/b.mp4", "https://v/b"]]),
      new Map([["thumbnails/a.jpg", "https://t/a"]])
    );
    expect(out.map((w) => [w.id, w.video_url, w.thumbnail_url])).toEqual([
      ["a", "https://v/a", "https://t/a"],
      ["b", "https://v/b", null],
    ]);
  });

  it("drops a row whose video could not be signed but keeps the rest", () => {
    const out = attachPlaybackUrls(
      [row("a", null), row("b", null)],
      new Map([["videos/b.mp4", "https://v/b"]]),
      new Map()
    );
    expect(out.map((w) => w.id)).toEqual(["b"]);
  });

  it("nulls a thumbnail that could not be signed", () => {
    const out = attachPlaybackUrls(
      [row("a", "thumbnails/a.jpg")],
      new Map([["videos/a.mp4", "https://v/a"]]),
      new Map()
    );
    expect(out[0].thumbnail_url).toBeNull();
  });
});

describe("attachAdminUrls", () => {
  it("keeps a row whose video could not be signed, with a null url", async () => {
    const { attachAdminUrls } = await import("@/lib/webinars");
    const out = attachAdminUrls(
      [row("a", "thumbnails/a.jpg"), row("b", null)],
      new Map([["videos/b.mp4", "https://v/b"]]),
      new Map([["thumbnails/a.jpg", "https://t/a"]])
    );
    expect(out.map((w) => [w.id, w.video_url, w.thumbnail_url])).toEqual([
      ["a", null, "https://t/a"],
      ["b", "https://v/b", null],
    ]);
  });
});

describe("signingDegraded", () => {
  it("is true only when there were rows to sign and the batch call failed", async () => {
    const { signingDegraded } = await import("@/lib/webinars");
    expect(signingDegraded(3, true)).toBe(true);
    expect(signingDegraded(3, false)).toBe(false);
    expect(signingDegraded(0, true)).toBe(false);
  });
});
