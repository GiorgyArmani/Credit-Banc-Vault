"use client";

import { useEffect } from 'react';
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

interface WebsiteTourProps {
    onStart?: () => void;
}

// Guided tour for the client dashboard. Ordered to follow the page top-to-bottom
// so driver.js scrolls smoothly, but weighted toward the part clients actually
// get stuck on: finding the document checklist and uploading files.
//
// Anchors live in: the dashboard page (#tour-welcome, #tour-progress, #tour-vault),
// advisor-display (#tour-advisor), profile-display (#tour-profile), and vault.tsx
// (#tour-checklist on the progress bar, #tour-upload on the first document card).
// Vault anchors render conditionally (the section can be collapsed, cards depend
// on requested docs), so startWebsiteTour() filters the list to anchors that are
// actually on the page before driving — a missing anchor is skipped, not shown
// as an orphaned modal popover.
const TOUR_STEPS: DriveStep[] = [
    {
        element: '#tour-welcome',
        popover: {
            title: 'Welcome to your Vault',
            description: 'This is your home base. Everything we need to move your funding forward is right here. The tour takes about a minute, and you can replay it anytime with the “Website Tour” button.',
            side: 'bottom',
            align: 'start',
        },
    },
    {
        element: '#tour-advisor',
        popover: {
            title: 'Your dedicated advisor',
            description: 'This is your point person from start to finish. Their email and phone are right here, so reach out anytime. No question is too small.',
            side: 'bottom',
            align: 'start',
        },
    },
    {
        element: '#tour-profile',
        popover: {
            title: 'Your business profile',
            description: 'These are the details underwriting uses to evaluate your funding. Take a quick look, and tell your advisor if anything needs updating.',
            side: 'top',
            align: 'start',
        },
    },
    {
        element: '#tour-progress',
        popover: {
            title: 'Where your application stands',
            description: 'Track your funding in real time as it moves through underwriting. Once your documents are submitted, you’ll watch it advance here, usually within 24 to 48 hours.',
            side: 'bottom',
            align: 'start',
        },
    },
    {
        element: '#tour-vault',
        popover: {
            title: 'The Document Vault',
            description: 'This is the most important part. Every document we need is listed below as its own card. Upload them here and your advisor sees them right away. No email chains, no faxing.',
            side: 'top',
            align: 'start',
        },
    },
    {
        element: '#tour-checklist',
        popover: {
            title: 'Your progress bar',
            description: 'This fills up as you upload each required document. When it reaches 100%, a “Submit Vault” button appears so you can send everything to underwriting.',
            side: 'bottom',
            align: 'start',
        },
    },
    {
        element: '#tour-upload',
        popover: {
            title: 'How to upload a document',
            description: 'Each card is one document we need. First, click a card to open it. Next, tap “Click to upload” and pick the file from your device. A clear photo of the page works too. Then press “Start Upload” and the badge changes to “Ready for Review”. If a card ever turns red, your advisor left a note. Open it, read the feedback, and upload a fresh file.',
            side: 'top',
            align: 'start',
        },
    },
];

export default function WebsiteTour({ onStart }: WebsiteTourProps) {
    // Expose a global starter the dashboard button + auto-start effect both call.
    useEffect(() => {
        if (typeof window === 'undefined') return;

        (window as any).startWebsiteTour = () => {
            // Only keep steps whose anchor is on the page right now. The Vault
            // can be collapsed and the document cards depend on requested docs,
            // so a hard-coded list would otherwise point driver.js at nothing.
            const steps = TOUR_STEPS.filter((s) =>
                typeof s.element === 'string' && document.querySelector(s.element),
            );
            if (steps.length === 0) return;

            const driverObj = driver({
                showProgress: true,
                animate: true,
                popoverClass: 'driverjs-theme',
                nextBtnText: 'Next →',
                prevBtnText: '← Back',
                doneBtnText: 'Got it',
                steps,
            });

            onStart?.();
            driverObj.drive();
        };
    }, [onStart]);

    return null; // This component doesn't render anything itself
}
