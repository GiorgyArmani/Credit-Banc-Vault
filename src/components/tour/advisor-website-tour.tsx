"use client";

import { useEffect, useRef } from 'react';
import { driver } from "driver.js";
import "driver.js/dist/driver.css";

interface AdvisorWebsiteTourProps {
    onStart?: () => void;
}

export default function AdvisorWebsiteTour({ onStart }: AdvisorWebsiteTourProps) {
    const driverObj = useRef<any>(null);

    useEffect(() => {
        driverObj.current = driver({
            showProgress: true,
            animate: true,
            popoverClass: 'driverjs-theme',
            steps: [
                {
                    element: '#tour-advisor-welcome',
                    popover: {
                        title: 'Welcome Advisor!',
                        description: 'This is your command center for managing clients and tracking applications.',
                        side: "bottom",
                        align: 'start'
                    }
                },
                {
                    element: '#tour-advisor-stats',
                    popover: {
                        title: 'Performance Overview',
                        description: 'Get a quick snapshot of your total clients, pending applications, and approval metrics.',
                        side: "bottom",
                        align: 'start'
                    }
                },
                {
                    element: '#tour-advisor-quick-actions',
                    popover: {
                        title: 'Quick Actions',
                        description: 'Fast track your workflow: create new applications, view client lists, or check pending reviews.',
                        side: "top",
                        align: 'start'
                    }
                },
                {
                    element: '#tour-advisor-activity',
                    popover: {
                        title: 'Recent Activity',
                        description: 'Stay updated with the latest client submissions and system notifications.',
                        side: "top",
                        align: 'start'
                    }
                }
            ]
        });
    }, []);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            (window as any).startAdvisorTour = () => {
                if (driverObj.current) {
                    driverObj.current.drive();
                }
            };
        }
    }, []);

    return null;
}
