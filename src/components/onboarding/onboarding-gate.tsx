'use client'
import { useState, useEffect, type ReactNode } from 'react'
import OnboardingModal from './onboarding-modal'
import { useOnboardingStatus } from './use-onboarding-status'
import { PremiumLoader } from '../ui/premium-loader'
import { motion, AnimatePresence } from 'framer-motion'

type OnboardingGateProps = { children: ReactNode }

export default function OnboardingGate({ children }: OnboardingGateProps) {
  const { needsOnboarding, dataVaultCompleted, contractCompleted, loading } = useOnboardingStatus()
  const [open, setOpen] = useState(false)
  const [showLoader, setShowLoader] = useState(true)
  const [animationFinished, setAnimationFinished] = useState(false)

  // Manage loader persistence and ease-out
  useEffect(() => {
    if (!loading) {
      // Add extra 1.5s for that premium "ease out" / "charging complete" feel
      const timer = setTimeout(() => {
        setShowLoader(false)

        // Wait for the CSS transition (1000ms) plus a small buffer before 
        // completely removing the classes that break fixed positioning
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
    const skipped = sessionStorage.getItem('skipOnboarding') === 'true'
    setOpen(needsOnboarding && !skipped)
  }, [needsOnboarding, loading])

  // Lock del body solo mientras el modal está abierto o durante la carga inicial
  useEffect(() => {
    if (!open && !showLoader) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open, showLoader])

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
          ? "opacity-100" // No transform or filter to allow stable fixed positioning
          : `transition-all duration-1000 min-h-screen flex flex-col ${showLoader ? "opacity-0 scale-95 blur-md" : "opacity-100 scale-100 blur-0"}`
      }>
        {children}
      </div>

      <OnboardingModal
        open={open}
        onClose={() => setOpen(false)}
        dataVaultCompleted={dataVaultCompleted}
        contractCompleted={contractCompleted}
      />
    </>
  )
}
