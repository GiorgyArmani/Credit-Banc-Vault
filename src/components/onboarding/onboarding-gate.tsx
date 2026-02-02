'use client'
import { useState, useEffect, type ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useOnboardingStatus } from './use-onboarding-status'
import { PremiumLoader } from '../ui/premium-loader'
import { motion, AnimatePresence } from 'framer-motion'

type OnboardingGateProps = { children: ReactNode }

export default function OnboardingGate({ children }: OnboardingGateProps) {
  const { needsOnboarding, loading } = useOnboardingStatus()
  const [showLoader, setShowLoader] = useState(true)
  const [animationFinished, setAnimationFinished] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  // Manage loader persistence and ease-out
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => {
        setShowLoader(false)
        const finishTimer = setTimeout(() => {
          setAnimationFinished(true)
        }, 1200)
        return () => clearTimeout(finishTimer)
      }, 1500)
      return () => clearTimeout(timer)
    } else {
      setShowLoader(true)
      setAnimationFinished(false)
    }
  }, [loading])

  useEffect(() => {
    if (loading) return

    // If onboarding is needed and we are NOT already on the onboarding page, redirect
    if (needsOnboarding && pathname !== '/onboarding') {
      router.push('/onboarding')
    }
  }, [needsOnboarding, loading, pathname, router])

  // Lock body scroll only during initial loading
  useEffect(() => {
    if (!showLoader) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [showLoader])

  return (
    <>
      <AnimatePresence>
        {showLoader && (
          <motion.div
            key="global-loader"
            initial={{ opacity: 1 }}
            exit={{
              opacity: 0,
              filter: "blur(10px)",
              scale: 1.1
            }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            className="fixed inset-0 z-[9999]"
          >
            <PremiumLoader
              fullScreen={true}
              message={loading ? "Authenticating and preparing your vault..." : "Systems Charged. Welcome back!"}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className={
        animationFinished
          ? "opacity-100"
          : `transition-all duration-1000 min-h-screen flex flex-col ${showLoader ? "opacity-0 scale-95 blur-md" : "opacity-100 scale-100 blur-0"}`
      }>
        {children}
      </div>
    </>
  )
}
