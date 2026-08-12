"use client";

// Guided tour of the deal workspace, for advisors and referral partners alike.
//
// Steps are resolved against the DOM at DRIVE TIME, not at mount. Two reasons:
// the topbar is `hidden md:flex`, so the profile-photo step simply doesn't exist
// on mobile; and the same tour runs in portals that render slightly different
// sections. driver.js points a popover at nothing when a selector misses, so
// anything absent is filtered out instead.

import { useEffect, useRef } from 'react';
import { driver } from "driver.js";
import "driver.js/dist/driver.css";

interface AdvisorWebsiteTourProps {
    onStart?: () => void;
    /** What this portal calls the viewer — "Advisor" or "Referral Partner". */
    roleLabel?: string;
}

export default function AdvisorWebsiteTour({ roleLabel = 'Advisor' }: AdvisorWebsiteTourProps) {
    const roleLabelRef = useRef(roleLabel);
    useEffect(() => { roleLabelRef.current = roleLabel; }, [roleLabel]);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        (window as any).startAdvisorTour = () => {
            const label = roleLabelRef.current;

            const steps = [
                {
                    element: '#tour-advisor-welcome',
                    popover: {
                        title: `Welcome, ${label}!`,
                        description: 'This is your command center for managing clients and tracking applications.',
                        side: "bottom" as const,
                        align: 'start' as const,
                    },
                },
                {
                    // Deliberately early. This is the only step that asks for
                    // something back, and it's the one thing on this screen a
                    // CLIENT ever sees — burying it at the end means the people
                    // who abandon the tour are exactly the people who never set
                    // a photo.
                    element: '#tour-profile-photo',
                    popover: {
                        title: 'Add your photo',
                        description:
                            'Click your avatar any time to set a profile photo. This is what your clients see next to your name on their dashboard — a real face does more for a first call than anything else on the page.',
                        side: "bottom" as const,
                        align: 'end' as const,
                    },
                },
                {
                    element: '#tour-advisor-stats',
                    popover: {
                        title: 'Performance Overview',
                        description: 'Get a quick snapshot of your total clients, pending applications, and approval metrics.',
                        side: "bottom" as const,
                        align: 'start' as const,
                    },
                },
                {
                    element: '#tour-advisor-quick-actions',
                    popover: {
                        title: 'Quick Actions',
                        description: 'Fast track your workflow: create new applications, view client lists, or check pending reviews.',
                        side: "top" as const,
                        align: 'start' as const,
                    },
                },
                {
                    element: '#tour-advisor-activity',
                    popover: {
                        title: 'Recent Activity',
                        description: 'Stay updated with the latest client submissions and system notifications.',
                        side: "top" as const,
                        align: 'start' as const,
                    },
                },
            ].filter((step) => document.querySelector(step.element));

            if (!steps.length) return;

            driver({
                showProgress: true,
                animate: true,
                popoverClass: 'driverjs-theme',
                steps,
            }).drive();
        };
    }, []);

    return null;
}
