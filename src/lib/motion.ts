import type { Variants, Transition } from 'framer-motion'

/**
 * Shared motion vocabulary for the creditbanc.io aesthetic.
 *
 * One easing curve everywhere. Import these instead of re-declaring variants
 * per file, otherwise entrances drift out of sync across surfaces.
 */

export const EASE = [0.22, 1, 0.36, 1] as const

/** Parent container: staggers its children's `fadeUp` entrances. */
export const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
}

/** The standard entrance: fade up 24px. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
}

/** Plain fade, for route-level transitions in data-dense views. */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3, ease: EASE } },
}

/** Standard viewport config: play once, when 30% of the block is on screen. */
export const viewportOnce = { once: true, amount: 0.3 } as const

/** Hover physics for interactive CTAs. Spread alongside `hoverSpring`. */
export const ctaHover = {
  scale: 1.04,
  boxShadow: '0 22px 40px -12px rgba(0, 3, 33, 0.4)',
} as const

export const ctaTap = { scale: 0.97 } as const

export const hoverSpring: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 22,
}

/** Layout-animated nav pill / tab indicator. */
export const pillSpring: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 32,
}

/**
 * Grid texture overlay for colored/dark bands. Render at opacity-[0.06]–[0.07]
 * on an `aria-hidden` absolutely-positioned div.
 */
export const GRID_OVERLAY: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
  backgroundSize: '56px 56px',
  maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
  WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
}

/** Same grid, dark stroke — for light/cream bands. */
export const GRID_OVERLAY_DARK: React.CSSProperties = {
  ...GRID_OVERLAY,
  backgroundImage:
    'linear-gradient(rgba(32,37,54,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(32,37,54,0.6) 1px, transparent 1px)',
}

/**
 * The approved deep-emerald gradient bands. Pick one, do not invent new greens.
 */
export const BAND_GRADIENT = {
  bright: 'linear-gradient(135deg, #1f6b4e 0%, #2ea878 50%, #55cf9e 100%)',
  standard: 'linear-gradient(135deg, #1f6b4e 0%, #2ea878 50%, #34b07d 100%)',
  deep: 'linear-gradient(135deg, #10402c 0%, #1f6b4e 50%, #2ea878 100%)',
  deepest: 'linear-gradient(135deg, #0d3b2a 0%, #165e44 50%, #2ea878 100%)',
} as const
