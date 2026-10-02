// src/lib/post-funding/links.ts
//
// Where every button in the post-funding sequence points. Each has an env
// override so a link can be repointed without a deploy; the defaults are the
// live destinations as of 2026-10-02 (the review link is the same g.page URL
// the advisor signatures use, and what GOOGLE_REVIEW_URL holds in prod).
//
// "booking" is per advisor — it comes from the signer's signature, see
// signatures.ts — so it is not here.

import type { PostFundingLink } from "./steps";

export function postFundingLinks(bookingUrl: string): Record<PostFundingLink, string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
  return {
    review: process.env.GOOGLE_REVIEW_URL || "https://g.page/r/CUu99pnQkahuEAI/review",
    booking: bookingUrl,
    weekly: process.env.POST_FUNDING_WEEKLY_URL || "https://theweeklyfromshieldadvisory.substack.com",
    // The public affiliate signup page in this app.
    affiliate: process.env.POST_FUNDING_AFFILIATE_URL || `${appUrl}/affiliate`,
    podcastListen:
      process.env.POST_FUNDING_PODCAST_LISTEN_URL || "https://www.theliquidlunchproject.com",
    podcastWatch:
      process.env.POST_FUNDING_PODCAST_WATCH_URL || "https://www.youtube.com/@theliquidlunchproject",
    youtube: process.env.POST_FUNDING_YOUTUBE_URL || "https://www.youtube.com/@Credit_Banc",
  };
}
