'use client'
import { useState, useEffect, type ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useOnboardingStatus } from './use-onboarding-status'
import { PremiumLoader } from '../ui/premium-loader'
import { motion, AnimatePresence } from 'framer-motion'
import { updateLoanStatus, getClientPipelineHistory } from '@/app/actions/pipeline'

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
      // If we need onboarding, don't wait for the artificial 1.5s delay
      if (needsOnboarding) {
        setShowLoader(false)
        setAnimationFinished(true)
        return
      }

      const timer = setTimeout(() => {
        setShowLoader(false)
        const finishTimer = setTimeout(() => {
          setAnimationFinished(true)
        }, 800) // Reduced from 1200
        return () => clearTimeout(finishTimer)
      }, 800) // Reduced from 1500
      return () => clearTimeout(timer)
    } else {
      setShowLoader(true)
      setAnimationFinished(false)
    }
  }, [loading, needsOnboarding])

  useEffect(() => {
    if (loading) return

    // If onboarding is needed and we are NOT already on the onboarding page, redirect
    if (needsOnboarding && pathname !== '/onboarding') {
      router.replace('/onboarding') // Using replace for cleaner history
    }
  }, [needsOnboarding, loading, pathname, router])

  // Pipeline sync: Move to 'onboarding' if currently in 'created'
  const { vaultId } = useOnboardingStatus()
  useEffect(() => {
    if (loading || !vaultId) return

    async function syncPipeline() {
      try {
        const history = await getClientPipelineHistory(vaultId!)
        if (history.length === 1 && history[0].status === 'created') {
          // Client-triggered: the actor is role='free', and loan_status_history
          // writes are staff-only under RLS, so this must use the service role.
          await updateLoanStatus(vaultId!, 'onboarding', 'Client accessed the vault for the first time', {
            useServiceRole: true,
          })
          console.log('✅ Pipeline status auto-advanced to "onboarding"')
        }
      } catch (err) {
        console.error('⚠️ Pipeline auto-sync error:', err)
      }
    }

    syncPipeline()
  }, [loading, vaultId])

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
