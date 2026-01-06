"use client"

import React from "react"
import { motion } from "framer-motion"

interface PremiumLoaderProps {
    message?: string
    fullScreen?: boolean
}

export function PremiumLoader({ message = "Loading your secure vault...", fullScreen = true }: PremiumLoaderProps) {
    return (
        <div className={`
      ${fullScreen ? "fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white" : "flex flex-col items-center justify-center p-12 w-full h-full min-h-[400px]"}
    `}>
            <div className="relative flex flex-col items-center">
                {/* Fixed-size wrapper for ring and logo to guarantee alignment */}
                <div className="relative w-24 h-24 flex items-center justify-center">
                    {/* Outer Ring Animation */}
                    <motion.div
                        animate={{ scale: [1, 1.1, 1], rotate: 360 }}
                        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                        className="absolute inset-0 rounded-full border-t-2 border-emerald-500/30 border-r-2 border-emerald-500/10 border-b-2 border-emerald-500/5"
                    />

                    {/* Inner pulsing logo container */}
                    <motion.div
                        animate={{ scale: [0.95, 1.05, 0.95], opacity: [0.8, 1, 0.8] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                        className="flex items-center justify-center p-4 w-full h-full"
                    >
                        <div className="relative w-full h-full flex items-center justify-center">
                            <img
                                src="/vaultlogo.svg"
                                alt="CreditBanc Vault Logo"
                                className="w-16 h-16 object-contain filter drop-shadow-xl"
                                onError={(e) => {
                                    // Fallback to PNG if SVG fails or is not found
                                    (e.target as HTMLImageElement).src = '/vaultlogo.png';
                                }}
                            />
                        </div>
                    </motion.div>
                </div>

                {/* Text Animation */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="mt-8 text-center"
                >
                    <p className="text-sm font-semibold tracking-widest text-emerald-600 uppercase mb-3">{message}</p>

                    {/* Charging progress bar */}
                    <div className="w-48 h-1 bg-emerald-100 rounded-full overflow-hidden relative">
                        <motion.div
                            initial={{ left: "-100%" }}
                            animate={{ left: "100%" }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                            className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-500 to-transparent w-full h-full"
                        />
                    </div>
                </motion.div>

                {/* Glossy Reflection Card Background (Subtle) */}
                <div className="absolute -z-10 w-48 h-48 bg-emerald-400/5 blur-3xl rounded-full" />
            </div>
        </div>
    )
}
