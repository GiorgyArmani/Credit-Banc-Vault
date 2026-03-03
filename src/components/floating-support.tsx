"use client"

import React from "react"
import Link from "next/link"
import { Phone, Mail, HelpCircle, X, MessageSquare } from "lucide-react"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"

/**
 * FloatingSupport component
 * Provides a persistent support button in the bottom right corner of the screen
 * containing contact information for support.
 */
export function FloatingSupport() {
    return (
        <div className="fixed bottom-6 right-6 z-50">
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        size="icon"
                        className="h-14 w-14 rounded-full shadow-2xl bg-primary hover:bg-primary/90 transition-all duration-300 hover:scale-110 group border-none"
                    >
                        <HelpCircle className="h-7 w-7 text-primary-foreground group-data-[state=open]:hidden animate-in fade-in duration-300" />
                        <X className="h-7 w-7 text-primary-foreground hidden group-data-[state=open]:block animate-in zoom-in duration-300" />
                        <span className="sr-only">Support</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    side="top"
                    align="end"
                    sideOffset={12}
                    className="w-72 p-0 overflow-hidden border-none shadow-2xl rounded-2xl animate-in slide-in-from-bottom-2 duration-300"
                >
                    {/* Header */}
                    <div className="bg-primary p-5 text-primary-foreground">
                        <h3 className="font-bold text-lg tracking-tight">Need Help?</h3>
                        <p className="text-xs opacity-90 text-primary-foreground/80 mt-1 uppercase tracking-wider font-semibold">Vault Support Team</p>
                    </div>

                    {/* Contact Methods */}
                    <div className="p-4 space-y-2 bg-card">
                        {/* Support Ticket Link */}
                        <Link
                            href="/support"
                            className="flex items-center gap-4 p-3 rounded-xl hover:bg-accent transition-all duration-200 group border border-transparent hover:border-accent-foreground/10"
                        >
                            <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary transition-all duration-200">
                                <MessageSquare className="h-5 w-5 text-primary group-hover:text-primary-foreground transition-all duration-200" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Create Ticket</span>
                                <span className="font-bold text-foreground group-hover:text-primary transition-colors">Send us a message</span>
                            </div>
                        </Link>

                        {/* Phone Link */}
                        <a
                            href="tel:+13214615024"
                            className="flex items-center gap-4 p-3 rounded-xl hover:bg-accent transition-all duration-200 group border border-transparent hover:border-accent-foreground/10"
                        >
                            <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary transition-all duration-200">
                                <Phone className="h-5 w-5 text-primary group-hover:text-primary-foreground transition-all duration-200" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Call Us</span>
                                <span className="font-bold text-foreground group-hover:text-primary transition-colors">+1 321-461-5024</span>
                            </div>
                        </a>

                        {/* Email Link */}
                        <a
                            href="mailto:support@creditbanc.io"
                            className="flex items-center gap-4 p-3 rounded-xl hover:bg-accent transition-all duration-200 group border border-transparent hover:border-accent-foreground/10"
                        >
                            <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary transition-all duration-200">
                                <Mail className="h-5 w-5 text-primary group-hover:text-primary-foreground transition-all duration-200" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Email Us</span>
                                <span className="font-bold text-foreground group-hover:text-primary transition-colors">support@creditbanc.io</span>
                            </div>
                        </a>
                    </div>

                    {/* Footer Decoration */}
                    <div className="p-2.5 bg-muted/30 border-t text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-widest font-bold">Credit Banc Vault</p>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    )
}
