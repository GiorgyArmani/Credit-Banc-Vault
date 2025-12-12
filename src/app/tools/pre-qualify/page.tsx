import React from 'react';
import PreQualifyCalculator from '@/components/tools/PreQualifyCalculator';
import styles from './page.module.css';

export const metadata = {
    title: 'Pre-Qualification Calculator | Credit Banc',
    description: 'Check your funding eligibility instantly with our lender matching tool.',
};

export default function PreQualifyPage() {
    return (
        <div className={styles.pageContainer}>
            <header className={styles.header}>
                <h1 className={styles.heading}>Fast Funding Pre-Check</h1>
                <p className={styles.subheading}>
                    See what you qualify for in seconds. No credit impact.
                </p>
            </header>

            <main className={styles.main}>
                <PreQualifyCalculator />
            </main>
        </div>
    );
}
