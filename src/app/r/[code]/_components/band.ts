// Shared band height for the /r/<code> landing page.
//
// Every section stands one viewport tall so scrolling moves in whole screens
// rather than in uneven jumps. `5rem` is BrandHeader's h-20 — if that header
// ever changes height, this is the one place to correct it, which is the whole
// reason it isn't written inline in three separate components.
//
// These are `min-h`, not `h`: a band is free to grow past a screen when its
// content demands it. The pre-qual section does exactly that once the booking
// calendar (700px+) replaces the form.

/** Full-height at every breakpoint. For single-column bands like the hero. */
export const BAND_MIN_H = "min-h-[calc(100vh-5rem)]";

/**
 * Full-height from `lg` up only. For split bands that stack on mobile — pinning
 * those to one screen would squeeze both halves into half a viewport each.
 */
export const BAND_MIN_H_LG = "lg:min-h-[calc(100vh-5rem)]";
