"use client";

import { useEffect, useRef } from 'react';
import { driver } from "driver.js";
import "driver.js/dist/driver.css";

interface WebsiteTourProps {
    onStart?: () => void;
}

export default function WebsiteTour({ onStart }: WebsiteTourProps) {
    const driverObj = useRef<any>(null);

    useEffect(() => {
        driverObj.current = driver({
            showProgress: true,
            animate: true,
            popoverClass: 'driverjs-theme',
            steps: [
                {
                    element: '#tour-welcome',
                    popover: {
                        title: 'Welcome to Credit Banc Vault!',
                        description: 'This is your secure hub for managing business funding documents. Let\'s take a quick look around.',
                        side: "bottom",
                        align: 'start'
                    }
                },
                {
                    element: '#tour-advisor',
                    popover: {
                        title: 'Your Dedicated Advisor',
                        description: 'Meet your funding expert. You can contact them directly via email or phone for any assistance.',
                        side: "bottom",
                        align: 'start'
                    }
                },
                {
                    element: '#tour-profile',
                    popover: {
                        title: 'Funding Information',
                        description: 'View your business profile details, including funding goals and industry information.',
                        side: "top",
                        align: 'start'
                    }
                },
                {
                    element: '#tour-vault',
                    popover: {
                        title: 'The Document Vault',
                        description: 'This is where you upload and manage all your required documents securely.',
                        side: "top",
                        align: 'start'
                    }
                },
                {
                    element: '#tour-progress',
                    popover: {
                        title: 'Track Your Progress',
                        description: 'Monitor your onboarding completion percentage. We aim for a 24-48h underwriting once complete!',
                        side: "bottom",
                        align: 'start'
                    }
                },
                {
                    element: '#tour-funding-app',
                    popover: {
                        title: 'Final Step: Funding Application',
                        description: 'Your first step to completion is uploading the funding application. You can find the template in the "Templates" tab above!',
                        side: "top",
                        align: 'start'
                    }
                }
            ]
        });
    }, []);

    // Expose the start function globally or via ref if needed, 
    // but for simplicity we'll just use a window property or a context if complex.
    // Here we'll just attach it to window for easy access from the button.
    useEffect(() => {
        if (typeof window !== 'undefined') {
            (window as any).startWebsiteTour = () => {
                if (driverObj.current) {
                    driverObj.current.drive();
                }
            };
        }
    }, []);

    return null; // This component doesn't render anything itself
}
