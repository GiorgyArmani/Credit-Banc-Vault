// f:\Credit Banc Vault\src\components\onboarding\data-vault-form.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SignaturePad } from "@/components/ui/signature-pad"
import { Loader2, Lock, Sparkles, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import clsx from "clsx"

interface DataVaultFormProps {
    onComplete: () => void
}

export function DataVaultForm({ onComplete }: DataVaultFormProps) {
    const [loading, setLoading] = useState(false)
    const [formData, setFormData] = useState({
        ein: "",
        ssn: "",
        industry: "",
        homeAddress: "",
        businessAddress: "",
    })

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!formData.ein || !formData.ssn || !formData.industry || !formData.homeAddress || !formData.businessAddress) {
            toast.error("Please fill in all required fields.")
            return
        }

        // Validate EIN is exactly 9 digits
        const einDigitsOnly = formData.ein.replace(/\D/g, '')
        if (einDigitsOnly.length !== 9) {
            toast.error("EIN Number must be exactly 9 digits.")
            return
        }

        // Validate SSN
        const ssnDigitsOnly = formData.ssn.replace(/\D/g, '')
        if (ssnDigitsOnly.length !== 9) {
            toast.error("SSN must be exactly 9 digits.")
            return
        }

        const ssnArea = ssnDigitsOnly.slice(0, 3)
        const ssnGroup = ssnDigitsOnly.slice(3, 5)
        const ssnSerial = ssnDigitsOnly.slice(5, 9)

        if (ssnArea === "000" || ssnArea === "666" || parseInt(ssnArea) >= 900) {
            toast.error("The SSN area number (first 3 digits) is invalid.")
            return
        }
        if (ssnGroup === "00") {
            toast.error("The SSN group number (middle 2 digits) is invalid.")
            return
        }
        if (ssnSerial === "0000") {
            toast.error("The SSN serial number (last 4 digits) is invalid.")
            return
        }

        setLoading(true)

        try {
            const response = await fetch("/api/onboarding/submit-step-1", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(formData),
            })

            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.message || "Failed to submit form")
            }

            toast.success("Information saved securely")
            onComplete()
        } catch (error: any) {
            console.error("Error submitting form:", error)
            toast.error(error.message || "Something went wrong. Please try again.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <Card className="w-full max-w-2xl mx-auto bg-white/80 backdrop-blur-xl border-emerald-50 rounded-[2.5rem] shadow-2xl overflow-hidden relative border">
            {/* internal glow effect */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />

            <CardHeader className="p-10 pb-6 relative z-10">
                <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center border border-emerald-100 shadow-inner">
                        <ShieldCheck className="w-6 h-6 text-emerald-500" />
                    </div>
                    <div>
                        <CardTitle className="text-2xl font-black uppercase tracking-tighter text-emerald-950 flex items-center gap-2">
                            Secure Data Vault
                            <Sparkles className="w-4 h-4 text-emerald-500/40" />
                        </CardTitle>
                        <CardDescription className="text-emerald-900/40 font-bold text-sm">
                            identity and business verification • encrypted
                        </CardDescription>
                    </div>
                </div>
                <p className="text-emerald-950/60 font-medium text-sm leading-relaxed bg-emerald-50/50 p-4 rounded-2xl border border-emerald-50">
                    Please provide the following information to verify your identity and business. This step is mandatory and cannot be skipped.
                </p>
            </CardHeader>

            <CardContent className="p-10 pt-0 relative z-10">
                <form onSubmit={handleSubmit} className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-3">
                            <Label
                                htmlFor="ein"
                                className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1"
                            >
                                EIN Number <span className="text-red-400">*</span>
                            </Label>
                            <Input
                                id="ein"
                                placeholder="XX-XXXXXXX"
                                value={formData.ein}
                                onChange={(e) => {
                                    // Only allow digits
                                    const value = e.target.value.replace(/\D/g, '')
                                    // Limit to 9 digits
                                    if (value.length <= 9) {
                                        // Format as XX-XXXXXXX
                                        let formatted = value
                                        if (value.length > 2) {
                                            formatted = value.slice(0, 2) + '-' + value.slice(2)
                                        }
                                        setFormData(prev => ({ ...prev, ein: formatted }))
                                    }
                                }}
                                maxLength={10}
                                required
                                className="h-14 rounded-xl border-emerald-100 bg-white/50 focus-visible:ring-emerald-500/20 font-bold text-emerald-950 placeholder:text-emerald-950/20 shadow-sm"
                            />
                            <p className="text-[10px] text-emerald-900/40 font-bold uppercase tracking-widest ml-1">Must be exactly 9 digits</p>
                        </div>
                        <div className="space-y-3">
                            <Label
                                htmlFor="ssn"
                                className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1"
                            >
                                SSN <span className="text-red-400">*</span>
                            </Label>
                            <Input
                                id="ssn"
                                placeholder="XXX-XX-XXXX"
                                value={formData.ssn}
                                onChange={(e) => {
                                    // Only allow digits
                                    const value = e.target.value.replace(/\D/g, '')
                                    // Limit to 9 digits
                                    if (value.length <= 9) {
                                        // Format as XXX-XX-XXXX
                                        let formatted = value
                                        if (value.length > 3 && value.length <= 5) {
                                            formatted = value.slice(0, 3) + '-' + value.slice(3)
                                        } else if (value.length > 5) {
                                            formatted = value.slice(0, 3) + '-' + value.slice(3, 5) + '-' + value.slice(5)
                                        }
                                        setFormData(prev => ({ ...prev, ssn: formatted }))
                                    }
                                }}
                                maxLength={11}
                                required
                                className="h-14 rounded-xl border-emerald-100 bg-white/50 focus-visible:ring-emerald-500/20 font-bold text-emerald-950 placeholder:text-emerald-950/20 shadow-sm"
                            />
                        </div>
                    </div>

                    <div className="space-y-3">
                        <Label
                            htmlFor="industry"
                            className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1"
                        >
                            Industry <span className="text-red-400">*</span>
                        </Label>
                        <Input
                            id="industry"
                            placeholder="e.g., Healthcare, Retail, Technology"
                            value={formData.industry}
                            onChange={(e) => setFormData(prev => ({ ...prev, industry: e.target.value }))}
                            required
                            className="h-14 rounded-xl border-emerald-100 bg-white/50 focus-visible:ring-emerald-500/20 font-bold text-emerald-950 placeholder:text-emerald-950/20 shadow-sm"
                        />
                    </div>

                    <div className="space-y-3">
                        <Label
                            htmlFor="homeAddress"
                            className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1"
                        >
                            Home Address <span className="text-red-400">*</span>
                        </Label>
                        <Input
                            id="homeAddress"
                            placeholder="Full Home Address"
                            value={formData.homeAddress}
                            onChange={(e) => setFormData(prev => ({ ...prev, homeAddress: e.target.value }))}
                            required
                            className="h-14 rounded-xl border-emerald-100 bg-white/50 focus-visible:ring-emerald-500/20 font-bold text-emerald-950 placeholder:text-emerald-950/20 shadow-sm"
                        />
                    </div>

                    <div className="space-y-3">
                        <Label
                            htmlFor="businessAddress"
                            className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1"
                        >
                            Business Address <span className="text-red-400">*</span>
                        </Label>
                        <Input
                            id="businessAddress"
                            placeholder="Full Business Address"
                            value={formData.businessAddress}
                            onChange={(e) => setFormData(prev => ({ ...prev, businessAddress: e.target.value }))}
                            required
                            className="h-14 rounded-xl border-emerald-100 bg-white/50 focus-visible:ring-emerald-500/20 font-bold text-emerald-950 placeholder:text-emerald-950/20 shadow-sm"
                        />
                    </div>

                    <Button
                        type="submit"
                        disabled={loading}
                        className="w-full h-16 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95 text-lg uppercase tracking-widest group"
                    >
                        {loading ? (
                            <div className="flex items-center gap-3">
                                <Loader2 className="h-5 w-5 animate-spin" />
                                <span>Saving securely...</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <Lock className="w-5 h-5 group-hover:scale-110 transition-transform" />
                                Save & Continue
                            </div>
                        )}
                    </Button>
                </form>
            </CardContent>
        </Card>
    )
}
