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
                        title: '1. Welcome to the Credit Banc Vault',
                        description: 'This is your secure hub for everything needed to move your funding forward. We’ll show you where things live and how to use the Vault in just a minute.',
                        side: "bottom",
                        align: 'start'
                    }
                },
                {
                    element: '#tour-advisor',
                    popover: {
                        title: '2. Your Dedicated Advisor',
                        description: 'This is your point person from start to finish. Reach out anytime by email or phone if you have questions or need help along the way.',
                        side: "bottom",
                        align: 'start'
                    }
                },
                {
                    element: '#tour-profile',
                    popover: {
                        title: '3. Your Funding Profile',
                        description: 'This is where your business details live. Review your funding goals, industry information, and other key details used during underwriting.',
                        side: "top",
                        align: 'start'
                    }
                },
                {
                    element: '#tour-vault',
                    popover: {
                        title: '4. The Document Vault',
                        description: 'All required documents, organized in one secure place. Upload, review, and manage everything underwriting needs, without the email chains.',
                        side: "top",
                        align: 'start'
                    }
                },
                {
                    element: '#tour-progress',
                    popover: {
                        title: '5. Track Your Progress',
                        description: 'You’ll always know where things stand. Watch your completion progress in real time. Once everything’s in, underwriting typically moves within 24–48 hours.',
                        side: "bottom",
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
