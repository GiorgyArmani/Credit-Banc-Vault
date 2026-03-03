"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    ArrowLeft,
    Send,
    CheckCircle2,
    AlertCircle,
    Mail,
    User,
    MessageSquare,
    Type
} from "lucide-react";

export default function SupportPage() {
    const [homeLink, setHomeLink] = useState("/");
    const supabase = createClient();
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        subject: "",
        message: ""
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");

    useEffect(() => {
        async function checkSession() {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data: profile } = await supabase
                    .from("users")
                    .select("role")
                    .eq("id", user.id)
                    .single();

                if (profile?.role === "advisor") {
                    setHomeLink("/advisor/dashboard");
                } else if (profile?.role === "underwriter") {
                    setHomeLink("/underwriting/dashboard");
                } else {
                    setHomeLink("/dashboard");
                }
            }
        }
        checkSession();
    }, [supabase]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setSubmitStatus("idle");

        try {
            const response = await fetch("/api/support", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(formData),
            });

            if (response.ok) {
                setSubmitStatus("success");
                setFormData({ name: "", email: "", subject: "", message: "" });
            } else {
                setSubmitStatus("error");
            }
        } catch (error) {
            console.error("Error submitting support ticket:", error);
            setSubmitStatus("error");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-white font-sans selection:bg-emerald-100 selection:text-emerald-900">
            {/* Navigation */}
            <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md">
                <div className="container mx-auto px-4">
                    <div className="flex h-20 items-center justify-between">
                        <Link href={homeLink} className="flex items-center space-x-2 group">
                            <Image
                                src="/vaultlogo.svg"
                                alt="Credit Banc Vault"
                                width={150}
                                height={65}
                                priority
                                className="h-10 w-auto transition-transform group-hover:scale-105"
                                onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.src = '/vaultlogo.png';
                                }}
                            />
                        </Link>
                        <Link
                            href={homeLink}
                            className="group flex items-center text-sm font-semibold text-gray-600 hover:text-emerald-600 transition-colors"
                        >
                            <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
                            {homeLink === "/" ? "Back to Home" : "Back to Dashboard"}
                        </Link>
                    </div>
                </div>
            </header>

            {/* Hero Content */}
            <section className="relative w-full bg-[#f0fdf7] overflow-hidden pt-20 pb-16">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/30 via-white/80 to-white" />
                <div className="container relative z-10 mx-auto px-4 text-center">
                    <h1 className="text-4xl md:text-6xl font-black mb-6 tracking-tight text-emerald-950">
                        How can we <span className="text-emerald-500">help?</span>
                    </h1>
                    <p className="text-xl text-emerald-900/60 max-w-2xl mx-auto font-medium">
                        Have a question, feedback, or need technical assistance? Fill out the form below and our support team will get back to you within 24 hours.
                    </p>
                </div>
            </section>

            {/* Form Section */}
            <section className="container mx-auto px-4 py-16 -mt-8 relative z-20">
                <div className="max-w-3xl mx-auto">
                    <Card className="border border-emerald-50 shadow-2xl rounded-[2.5rem] overflow-hidden bg-white">
                        <CardHeader className="pt-12 px-8 md:px-12 text-center">
                            <CardTitle className="text-3xl font-black text-emerald-950 tracking-tight">Create a Support Ticket</CardTitle>
                            <CardDescription className="text-lg text-emerald-900/40 font-bold uppercase tracking-widest mt-2">
                                We're here to support your success
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="pb-12 px-8 md:px-12">
                            {submitStatus === "success" ? (
                                <div className="py-12 text-center animate-in fade-in zoom-in duration-500">
                                    <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-500 shadow-inner">
                                        <CheckCircle2 className="h-12 w-12" />
                                    </div>
                                    <h3 className="text-3xl font-black text-emerald-950 mb-4 tracking-tight">Ticket Submitted!</h3>
                                    <p className="text-lg text-emerald-900/60 font-bold mb-10 max-w-md mx-auto">
                                        Your request has been received. Our team is reviewing it and will email you shortly.
                                    </p>
                                    <Button
                                        className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold h-14 px-10 rounded-2xl shadow-lg shadow-emerald-500/20"
                                        onClick={() => setSubmitStatus("idle")}
                                    >
                                        Send Another Message
                                    </Button>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} className="space-y-6">
                                    {submitStatus === "error" && (
                                        <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl flex items-center animate-in slide-in-from-top-4 duration-300">
                                            <AlertCircle className="h-5 w-5 mr-3 shrink-0" />
                                            <p className="font-bold tracking-tight">Something went wrong. Please try again later.</p>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <label htmlFor="name" className="text-sm font-black text-emerald-950 uppercase tracking-widest ml-1">Full Name</label>
                                            <div className="relative group">
                                                <User className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-emerald-200 group-focus-within:text-emerald-500 transition-colors" />
                                                <Input
                                                    id="name"
                                                    name="name"
                                                    placeholder="Your name"
                                                    required
                                                    value={formData.name}
                                                    onChange={handleChange}
                                                    className="h-14 pl-12 rounded-2xl border-emerald-50 bg-emerald-50/30 focus:bg-white focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label htmlFor="email" className="text-sm font-black text-emerald-950 uppercase tracking-widest ml-1">Email Address</label>
                                            <div className="relative group">
                                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-emerald-200 group-focus-within:text-emerald-500 transition-colors" />
                                                <Input
                                                    id="email"
                                                    name="email"
                                                    type="email"
                                                    placeholder="your@email.com"
                                                    required
                                                    value={formData.email}
                                                    onChange={handleChange}
                                                    className="h-14 pl-12 rounded-2xl border-emerald-50 bg-emerald-50/30 focus:bg-white focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label htmlFor="subject" className="text-sm font-black text-emerald-950 uppercase tracking-widest ml-1">Subject</label>
                                        <div className="relative group">
                                            <Type className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-emerald-200 group-focus-within:text-emerald-500 transition-colors" />
                                            <Input
                                                id="subject"
                                                name="subject"
                                                placeholder="What can we help you with?"
                                                required
                                                value={formData.subject}
                                                onChange={handleChange}
                                                className="h-14 pl-12 rounded-2xl border-emerald-50 bg-emerald-50/30 focus:bg-white focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label htmlFor="message" className="text-sm font-black text-emerald-950 uppercase tracking-widest ml-1">Message</label>
                                        <div className="relative group">
                                            <MessageSquare className="absolute left-4 top-5 h-5 w-5 text-emerald-200 group-focus-within:text-emerald-500 transition-colors" />
                                            <Textarea
                                                id="message"
                                                name="message"
                                                placeholder="Tell us more about your inquiry..."
                                                required
                                                value={formData.message}
                                                onChange={handleChange}
                                                className="min-h-[160px] pl-12 pt-4 rounded-2xl border-emerald-50 bg-emerald-50/30 focus:bg-white focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium resize-none"
                                            />
                                        </div>
                                    </div>

                                    <Button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="w-full h-16 bg-emerald-500 hover:bg-emerald-600 text-white text-xl font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed group"
                                    >
                                        {isSubmitting ? (
                                            <span className="flex items-center">
                                                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                                Sending...
                                            </span>
                                        ) : (
                                            <span className="flex items-center justify-center">
                                                Submit Ticket
                                                <Send className="ml-3 h-5 w-5 transform group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                                            </span>
                                        )}
                                    </Button>
                                </form>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </section>

            {/* Footer (Simplified as in landing page) */}
            <footer className="bg-emerald-950 text-white py-20 relative overflow-hidden mt-20">
                <div className="container mx-auto px-4 relative z-10 flex flex-col items-center space-y-12">
                    <Link href={homeLink} className="transition-all hover:scale-110 active:scale-95 group">
                        <Image
                            src="/vaultlogo.svg"
                            alt="Credit Banc Vault"
                            width={180}
                            height={80}
                            priority
                            className="h-14 w-auto brightness-0 invert opacity-90 group-hover:opacity-100 transition-opacity"
                            onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.src = '/vaultlogo.png';
                            }}
                        />
                    </Link>
                    <p className="text-emerald-100/20 text-xs font-black uppercase tracking-[0.4em]">
                        © {new Date().getFullYear()} Credit Banc. All rights reserved.
                    </p>
                </div>
            </footer>
        </div>
    );
}
