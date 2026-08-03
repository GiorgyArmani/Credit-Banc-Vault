"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    BrandHeader,
    BrandFooter,
    BrandBackdrop,
    BrandCard,
    BrandIconTile,
    Eyebrow,
    CTA,
    FIELD,
} from "@/components/marketing/brand-chrome";
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
        <div className="min-h-screen bg-cb-cream font-body text-cb-ink">
            <BrandHeader
                href={homeLink}
                action={
                    <Link
                        href={homeLink}
                        className="group flex items-center text-sm font-semibold text-cb-gray transition-colors hover:text-cb-ink"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
                        {homeLink === "/" ? "Back to home" : "Back to dashboard"}
                    </Link>
                }
            />

            {/* Hero */}
            <section className="relative w-full overflow-hidden">
                <BrandBackdrop />
                <div className="relative z-10 mx-auto max-w-4xl px-6 pb-12 pt-20 text-center sm:px-8 md:pt-28">
                    <Eyebrow className="mb-4">Support</Eyebrow>
                    <h1 className="font-headline text-4xl font-extrabold leading-[1.05] tracking-tight text-cb-ink md:text-6xl">
                        How can we <span className="text-cb-mint">help?</span>
                    </h1>
                    <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-cb-ink/60">
                        Question, feedback, or something broken? Fill out the form and our support
                        team gets back to you within 24 hours.
                    </p>
                </div>
            </section>

            {/* Form Section */}
            <section className="relative z-20 mx-auto max-w-3xl px-6 pb-20 sm:px-8">
                    <BrandCard padded={false}>
                        <div className="px-8 pt-10 text-center md:px-12">
                            <h2 className="font-headline text-3xl font-extrabold tracking-tight text-cb-ink">
                                Create a support ticket
                            </h2>
                            <p className="mt-2 text-[15px] text-cb-ink/60">
                                We&apos;re here to support your success.
                            </p>
                        </div>
                        <div className="px-8 pb-12 pt-8 md:px-12">
                            {submitStatus === "success" ? (
                                <div className="py-10 text-center animate-in fade-in zoom-in duration-500">
                                    <BrandIconTile size="lg" className="mb-6">
                                        <CheckCircle2 className="h-8 w-8" />
                                    </BrandIconTile>
                                    <h3 className="font-headline text-3xl font-extrabold tracking-tight text-cb-ink">
                                        Ticket <span className="text-cb-mint">submitted</span>
                                    </h3>
                                    <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-cb-ink/70">
                                        We have your request. The team is reviewing it and will email
                                        you shortly.
                                    </p>
                                    <button
                                        type="button"
                                        className={`${CTA.primary} mt-8`}
                                        onClick={() => setSubmitStatus("idle")}
                                    >
                                        Send another message
                                    </button>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} className="space-y-6">
                                    {submitStatus === "error" && (
                                        <p className={`${FIELD.error} flex items-center gap-3 animate-in slide-in-from-top-4 duration-300`}>
                                            <AlertCircle className="h-5 w-5 shrink-0" />
                                            Something went wrong. Please try again later.
                                        </p>
                                    )}

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <label htmlFor="name" className={FIELD.label}>Full Name</label>
                                            <div className="relative group">
                                                <User className={FIELD.icon} />
                                                <Input
                                                    id="name"
                                                    name="name"
                                                    placeholder="Your name"
                                                    required
                                                    value={formData.name}
                                                    onChange={handleChange}
                                                    className={FIELD.inputWithIcon}
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label htmlFor="email" className={FIELD.label}>Email Address</label>
                                            <div className="relative group">
                                                <Mail className={FIELD.icon} />
                                                <Input
                                                    id="email"
                                                    name="email"
                                                    type="email"
                                                    placeholder="your@email.com"
                                                    required
                                                    value={formData.email}
                                                    onChange={handleChange}
                                                    className={FIELD.inputWithIcon}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label htmlFor="subject" className={FIELD.label}>Subject</label>
                                        <div className="relative group">
                                            <Type className={FIELD.icon} />
                                            <Input
                                                id="subject"
                                                name="subject"
                                                placeholder="What can we help you with?"
                                                required
                                                value={formData.subject}
                                                onChange={handleChange}
                                                className={FIELD.inputWithIcon}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label htmlFor="message" className={FIELD.label}>Message</label>
                                        <div className="relative group">
                                            <MessageSquare className="pointer-events-none absolute left-4 top-4 h-4 w-4 text-cb-gray" />
                                            <Textarea
                                                id="message"
                                                name="message"
                                                placeholder="Tell us more about your inquiry..."
                                                required
                                                value={formData.message}
                                                onChange={handleChange}
                                                className="min-h-[160px] resize-none rounded-xl border-black/10 bg-white pl-11 pt-3.5 font-medium placeholder:text-cb-gray/60 focus-visible:ring-cb-mint/40"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className={`${CTA.primary} group w-full`}
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <span
                                                    aria-hidden
                                                    className="h-4 w-4 animate-spin rounded-full border-2 border-primary-fixed/30 border-t-primary-fixed"
                                                />
                                                Sending…
                                            </>
                                        ) : (
                                            <>
                                                Submit ticket
                                                <Send className="h-5 w-5 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
                                            </>
                                        )}
                                    </button>
                                </form>
                            )}
                        </div>
                    </BrandCard>
            </section>

            <BrandFooter />
        </div>
    );
}
