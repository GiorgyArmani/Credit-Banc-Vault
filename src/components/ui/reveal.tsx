'use client'

import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'
import { EASE } from '@/lib/motion'

type Direction = 'up' | 'down' | 'left' | 'right'

interface RevealProps {
  children: ReactNode
  /** Seconds to wait before the entrance starts. */
  delay?: number
  /** Which way the content travels in from. Defaults to `up`. */
  direction?: Direction
  /** Travel distance in px. Defaults to 32. */
  distance?: number
  duration?: number
  /** How much of the block must be visible before it plays. */
  amount?: number
  className?: string
}

const OFFSETS: Record<Direction, (d: number) => { x: number; y: number }> = {
  up: (d) => ({ x: 0, y: d }),
  down: (d) => ({ x: 0, y: -d }),
  left: (d) => ({ x: d, y: 0 }),
  right: (d) => ({ x: -d, y: 0 }),
}

/**
 * Scroll-triggered entrance. The workhorse for public/marketing surfaces —
 * wrap each section in it.
 *
 * Do not use inside data-dense dashboard views; per the design system those
 * get a single route-level fade instead.
 */
export function Reveal({
  children,
  delay = 0,
  direction = 'up',
  distance = 32,
  duration = 0.7,
  amount = 0.2,
  className,
}: RevealProps) {
  const reduceMotion = useReducedMotion()
  const offset = OFFSETS[direction](distance)

  // The rendered element and its `initial` styles must be IDENTICAL on the
  // server and on the first client render. `useReducedMotion()` is null during
  // SSR and only resolves in the browser, so branching on it here would change
  // the tree at hydration — React refuses to patch that up, and the server's
  // `opacity: 0` would stick, leaving the section permanently invisible.
  //
  // So: same markup either way. Reduced motion only collapses the transition,
  // which snaps the content to its resting state instead of travelling.
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, ...offset }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, amount }}
      transition={reduceMotion ? { duration: 0 } : { duration, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

export default Reveal
