"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SignaturePad } from "@/components/ui/signature-pad"
import { Loader2, Lock } from "lucide-react"
import { toast } from "sonner"

interface DataVaultFormProps {
    onComplete: () => void
}

export function DataVaultForm({ onComplete }: DataVaultFormProps) {
    const [loading, setLoading] = useState(false)
    const [formData, setFormData] = useState({
        ein: "",
        ssn: "",
        applicant1Signature: "",
        coApplicantSignature: "",
    })

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!formData.ein || !formData.ssn || !formData.applicant1Signature || !formData.coApplicantSignature) {
            toast.error("Please fill in all required fields and provide both signatures.")
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
        <Card className="w-full max-w-2xl mx-auto">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Lock className="w-5 h-5 text-emerald-600" />
                    Secure Data Vault
                </CardTitle>
                <CardDescription>
                    Please provide the following information to verify your identity and business.
                    This step is mandatory and cannot be skipped.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="ein">EIN Number <span className="text-red-500">*</span></Label>
                            <Input
                                id="ein"
                                placeholder="XX-XXXXXXX"
                                value={formData.ein}
                                onChange={(e) => setFormData(prev => ({ ...prev, ein: e.target.value }))}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="ssn">SSN <span className="text-red-500">*</span></Label>
                            <Input
                                id="ssn"
                                placeholder="XXX-XX-XXXX"
                                value={formData.ssn}
                                onChange={(e) => setFormData(prev => ({ ...prev, ssn: e.target.value }))}
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Applicant 1 Signature <span className="text-red-500">*</span></Label>
                        <SignaturePad
                            onChange={(base64) => setFormData(prev => ({ ...prev, applicant1Signature: base64 || "" }))}
                            className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">Sign above using your mouse or finger.</p>
                    </div>

                    <div className="space-y-2">
                        <Label>Co-applicant Signature <span className="text-red-500">*</span></Label>
                        <SignaturePad
                            onChange={(base64) => setFormData(prev => ({ ...prev, coApplicantSignature: base64 || "" }))}
                            className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">Sign above using your mouse or finger.</p>
                    </div>

                    <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving securely...
                            </>
                        ) : (
                            "Save & Continue"
                        )}
                    </Button>
                </form>
            </CardContent>
        </Card>
    )
}
