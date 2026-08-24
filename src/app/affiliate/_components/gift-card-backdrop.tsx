"use client";

// Gift-card backdrop for the /affiliate hero — two slow strips of the actual
// cards Giftronaut ships, drifting in opposite directions BEHIND the headline.
// They read on the left and right flanks; a cream scrim over the middle keeps
// the type on clean background, so the cards appear to pass under the words.
//
// Decorative only: aria-hidden, pointer-events-none, and it never renders below
// lg, where the hero text fills the width and the cards would just be clutter.

import Image from "next/image";

type GiftCard = { src: string; label: string };

// Art lives in public/giftcards/ (640x400 each). Order alternates household
// names and lifestyle brands so neither strip reads as a single category.
const GIFT_CARDS: GiftCard[] = [
  { src: "/giftcards/2.jpg", label: "Amazon" },
  { src: "/giftcards/5.jpg", label: "Target" },
  { src: "/giftcards/18.jpg", label: "Starbucks" },
  { src: "/giftcards/11.jpg", label: "Airbnb" },
  { src: "/giftcards/9.jpg", label: "Apple" },
  { src: "/giftcards/3.jpg", label: "Walmart" },
  { src: "/giftcards/8.jpg", label: "Uber" },
  { src: "/giftcards/14.jpg", label: "Netflix" },
  { src: "/giftcards/17.jpg", label: "Visa Reward" },
  { src: "/giftcards/15.jpg", label: "DoorDash" },
  { src: "/giftcards/12.jpg", label: "Disney" },
  { src: "/giftcards/7.jpg", label: "Macy's" },
  { src: "/giftcards/16.jpg", label: "Sephora" },
  { src: "/giftcards/10.jpg", label: "IKEA" },
  { src: "/giftcards/4.jpg", label: "Grubhub" },
  { src: "/giftcards/6.jpg", label: "Hotels.com" },
  { src: "/giftcards/13.jpg", label: "CVS Pharmacy" },
  { src: "/giftcards/1.jpg", label: "Google Play" },
];

const ROWS: GiftCard[][] = [GIFT_CARDS.slice(0, 9), GIFT_CARDS.slice(9)];

// Small alternating tilts so the strip reads as scattered cards rather than a
// filmstrip. Cycled by index, so it stays identical across both track copies.
const TILTS = ["-4deg", "3deg", "-2deg", "5deg", "-3deg"];

/**
 * One drifting strip. The track holds its row TWICE and slides exactly -50%
 * (one whole copy), so the hand-off is seamless — and because both copies are
 * identical in width, that holds running in reverse too. Keyframes
 * (`cb-marquee`) live in globals.css: duration, delay and direction vary per
 * instance and come from inline style, which Tailwind's arbitrary-animation
 * syntax cannot express. Reduced motion is already handled globally.
 */
function CardStrip({
  row,
  duration,
  delay,
  reverse,
  className,
}: {
  row: GiftCard[];
  duration: string;
  delay?: string;
  reverse?: boolean;
  className?: string;
}) {
  return (
    // `overflow-hidden` clips the track (two copies of the row is far wider
    // than the screen) — but a rotated card's bounding box is taller than its
    // layout box, so without the vertical padding that same clip slices the
    // tilted corners flat. py-5 (20px) clears the worst case: a 196px card at
    // 5deg bleeds ~9px past its box on each side.
    <div className={`absolute inset-x-0 flex overflow-hidden py-5 ${className ?? ""}`}>
      <div
        className="flex w-max shrink-0"
        style={{
          animation: `cb-marquee ${duration} linear infinite`,
          animationDelay: delay,
          animationDirection: reverse ? "reverse" : undefined,
        }}
      >
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 gap-7 pr-7">
            {row.map((card, i) => (
              <div
                key={`${copy}-${card.src}`}
                // 640x400 art, so the frame is a fixed 8:5 box the image fills.
                className="relative aspect-[8/5] w-[172px] shrink-0 overflow-hidden rounded-xl bg-white opacity-90 shadow-[0_22px_44px_-26px_rgba(32,37,54,0.85)] ring-1 ring-on-secondary-fixed/10 xl:w-[196px]"
                style={{ transform: `rotate(${TILTS[i % TILTS.length]})` }}
              >
                <Image
                  src={card.src}
                  alt=""
                  fill
                  sizes="196px"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Horizontal mask for the whole backdrop: fade in from the screen edge, run
// solid across each flank, then vanish before the text column (±25rem of
// center) and stay gone across it. See the note in GiftCardBackdrop for why
// this is a mask rather than a painted scrim.
const MASK =
  "linear-gradient(90deg, transparent 0, #000 4rem, #000 calc(50% - 31rem), transparent calc(50% - 25rem), transparent calc(50% + 25rem), #000 calc(50% + 31rem), #000 calc(100% - 4rem), transparent 100%)";

export function GiftCardBackdrop() {
  return (
    <div
      aria-hidden
      // Breaks out of the hero's max-w-3xl column to full viewport width; the
      // hero section is overflow-hidden, so the bleed never adds scroll.
      className="pointer-events-none absolute left-1/2 top-[-2rem] hidden h-[calc(100%+4rem)] w-screen -translate-x-1/2 lg:block"
      style={{
        // The cards are MASKED, not covered. An earlier version painted cream
        // rectangles over the middle and the edges; cream is not what is behind
        // them (BrandBackdrop lays a mint-tinted gradient under this whole
        // section), so every rectangle showed its own border as a seam — the
        // one that ran across the page just under the header. A mask removes
        // pixels instead of adding them, so whatever the backdrop is doing
        // shows through untouched and there is no edge to see.
        //
        // Stops are anchored to `50% ± rem`, not to percentages, so the clear
        // middle stays locked to the hero's own 48rem text column at every
        // width — a wide screen cannot pull card art back in under the
        // headline, and a narrow one cannot squeeze it onto the words. Below
        // ~1024px the outer stops cross over and the whole strip masks itself
        // away, which is the behavior we want anyway (this is `hidden lg:block`).
        WebkitMaskImage: MASK,
        maskImage: MASK,
      }}
    >
      <CardStrip row={ROWS[0]} duration="42s" className="top-[6%]" />
      <CardStrip
        row={ROWS[1]}
        duration="54s"
        delay="-13s"
        reverse
        className="top-[48%]"
      />
    </div>
  );
}
