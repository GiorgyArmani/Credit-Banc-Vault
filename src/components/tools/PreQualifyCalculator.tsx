'use client';

import React, { useState } from 'react';
import { LENDERS_DATA } from '@/data/lenders';
import { evaluateAllLenders } from '@/utils/lender-qualifier-utils';
import type { ClientProfile, QualificationResult } from '@/types/lender-qualifier-types';
import styles from './PreQualifyCalculator.module.css';

const INDUSTRIES = [
    'General',
    'Construction',
    'Retail',
    'Restaurant/Hospitality',
    'Trucking/Transportation',
    'Medical/Health',
    'Manufacturing',
    'Services',
    'Other'
];

const TIME_IN_BUSINESS = [
    { label: 'Less than 6 months', value: '3' },
    { label: '6 months - 1 year', value: '6' },
    { label: '1 - 2 years', value: '12' },
    { label: '2 - 3 years', value: '24' },
    { label: '3+ years', value: '36' }
];

const STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

const PURPOSES = [
    'Working Capital',
    'Equipment',
    'Real Estate',
    'Expansion',
    'Debt Consolidation',
    'Payroll',
    'Marketing',
    'Other'
];

interface FormData {
    capital: string;
    creditScore: string;
    revenue: string;
    depositsCount: string;
    purpose: string;
    timeInBusiness: string;
    state: string;
    industry: string;
    bankruptcy: 'yes' | 'no';
}

export default function PreQualifyCalculator() {
    const [formData, setFormData] = useState<FormData>({
        capital: '50000',
        creditScore: '680',
        revenue: '25000',
        depositsCount: '5',
        purpose: 'Working Capital',
        timeInBusiness: '24',
        state: 'TX',
        industry: 'General',
        bankruptcy: 'no'
    });

    const [showModal, setShowModal] = useState(false);
    const [qualifiedLenders, setQualifiedLenders] = useState<QualificationResult[]>([]);
    const [fundingPotential, setFundingPotential] = useState<number>(0);
    const [profileStrength, setProfileStrength] = useState<'Excellent' | 'Good' | 'Fair' | 'Poor'>('Poor');

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleCalculate = () => {
        const months = parseInt(formData.timeInBusiness);
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - months);

        const tempProfile: ClientProfile = {
            id: 'temp-calc',
            client_name: 'Guest',
            company_name: 'Guest Company',
            company_state: formData.state,
            company_city: null,
            capital_requested: Number(formData.capital),
            loan_purpose: formData.purpose,
            proposed_loan_type: 'General',
            avg_monthly_deposits: Number(formData.revenue),
            avg_monthly_deposit_count: Number(formData.depositsCount),
            avg_annual_revenue: Number(formData.revenue) * 12,
            legal_entity_type: 'LLC',
            business_start_date: startDate.toISOString(),
            is_home_based: false,
            employees_count: 5,
            credit_score: '700+', // Placeholder, util checks exact_credit_score
            exact_credit_score: Number(formData.creditScore),
            industry: formData.industry,
            has_existing_loans: false,
            has_defaulted_mca: false,
            mca_was_satisfied: null,
            owns_real_estate: false,
            has_reduced_mca_payments: false,
            has_personal_debt_over_75k: null,
            has_bankruptcy_foreclosure_3y: formData.bankruptcy === 'yes',
            has_tax_liens: false,
            has_active_judgements: false,
            has_zbl: null,
            funding_eta: 'ASAP',
            additional_notes: 'Calculator Pre-qual check'
        };

        const results = evaluateAllLenders(tempProfile, LENDERS_DATA);
        const qualified = results.filter(r => r.is_qualified);

        // Revenue Gap Logic (Max 1.5x Annual Revenue)
        const annualRevenue = Number(formData.revenue) * 12;
        const revenueBasedCap = annualRevenue * 1.5;

        let maxFunding = 0;

        qualified.forEach(q => {
            let lenderLimit = q.max_funding;
            if (lenderLimit === null || lenderLimit === undefined) {
                lenderLimit = 5000000;
            }
            const effectivePotential = Math.min(lenderLimit, revenueBasedCap);
            if (effectivePotential > maxFunding) {
                maxFunding = effectivePotential;
            }
        });

        if (qualified.length > 0 && maxFunding === 0) {
            maxFunding = Math.min(Number(formData.capital), revenueBasedCap);
        }

        setQualifiedLenders(qualified);
        setFundingPotential(maxFunding);

        if (qualified.length > 20) setProfileStrength('Excellent');
        else if (qualified.length > 10) setProfileStrength('Good');
        else if (qualified.length > 0) setProfileStrength('Fair');
        else setProfileStrength('Poor');

        setShowModal(true);
    };

    return (
        <div className={styles.container}>
            <h2 className={styles.title}>Check Your Funding Eligibility</h2>

            <div className={styles.grid}>
                <div className={styles.formGroup}>
                    <label className={styles.label} htmlFor="capital">Capital Needed ($)</label>
                    <input
                        type="number"
                        id="capital"
                        name="capital"
                        value={formData.capital}
                        onChange={handleChange}
                        className={styles.input}
                        min="1000"
                        placeholder="e.g. 50000"
                    />
                </div>

                <div className={styles.formGroup}>
                    <label className={styles.label} htmlFor="revenue">Avg. Monthly Revenue ($)</label>
                    <input
                        type="number"
                        id="revenue"
                        name="revenue"
                        value={formData.revenue}
                        onChange={handleChange}
                        className={styles.input}
                        min="0"
                        placeholder="e.g. 25000"
                    />
                </div>
            </div>

            <div className={styles.grid}>
                <div className={styles.formGroup}>
                    <label className={styles.label} htmlFor="creditScore">Credit Score (Exact)</label>
                    <input
                        type="number"
                        id="creditScore"
                        name="creditScore"
                        value={formData.creditScore}
                        onChange={handleChange}
                        className={styles.input}
                        min="300"
                        max="850"
                        placeholder="e.g. 720"
                    />
                </div>

                <div className={styles.formGroup}>
                    <label className={styles.label} htmlFor="timeInBusiness">Time in Business</label>
                    <select
                        id="timeInBusiness"
                        name="timeInBusiness"
                        value={formData.timeInBusiness}
                        onChange={handleChange}
                        className={styles.select}
                    >
                        {TIME_IN_BUSINESS.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className={styles.grid}>
                <div className={styles.formGroup}>
                    <label className={styles.label} htmlFor="state">State</label>
                    <select
                        id="state"
                        name="state"
                        value={formData.state}
                        onChange={handleChange}
                        className={styles.select}
                    >
                        {STATES.map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </div>

                <div className={styles.formGroup}>
                    <label className={styles.label} htmlFor="depositsCount">Monthly Deposits (Count)</label>
                    <input
                        type="number"
                        id="depositsCount"
                        name="depositsCount"
                        value={formData.depositsCount}
                        onChange={handleChange}
                        className={styles.input}
                        min="0"
                        placeholder="e.g. 5"
                    />
                </div>
            </div>

            <div className={styles.grid}>
                <div className={styles.formGroup}>
                    <label className={styles.label} htmlFor="industry">Industry</label>
                    <select
                        id="industry"
                        name="industry"
                        value={formData.industry}
                        onChange={handleChange}
                        className={styles.select}
                    >
                        {INDUSTRIES.map(i => (
                            <option key={i} value={i}>{i}</option>
                        ))}
                    </select>
                </div>
                <div className={styles.formGroup}>
                    <label className={styles.label} htmlFor="purpose">Purpose of Funds</label>
                    <select
                        id="purpose"
                        name="purpose"
                        value={formData.purpose}
                        onChange={handleChange}
                        className={styles.select}
                    >
                        {PURPOSES.map(p => (
                            <option key={p} value={p}>{p}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className={styles.formGroup}>
                <label className={styles.label}>Filed for Bankruptcy in last 3 years?</label>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                            type="radio"
                            name="bankruptcy"
                            value="yes"
                            checked={formData.bankruptcy === 'yes'}
                            onChange={handleChange}
                        />
                        Yes
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                            type="radio"
                            name="bankruptcy"
                            value="no"
                            checked={formData.bankruptcy === 'no'}
                            onChange={handleChange}
                        />
                        No
                    </label>
                </div>
            </div>

            <button onClick={handleCalculate} className={styles.calculateButton}>
                See How Much You Qualify For
            </button>

            {showModal && (
                <div className={styles.modalOverlay} onClick={() => setShowModal(false)}>
                    <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
                        <button className={styles.closeButton} onClick={() => setShowModal(false)}>&times;</button>

                        {qualifiedLenders.length > 0 ? (
                            <div className={styles.resultsContainer}>
                                <div className={styles.statsHeader}>
                                    <div className={styles.strengthBadge} data-strength={profileStrength}>
                                        Profile: {profileStrength}
                                    </div>
                                    <div className={styles.matchCount}>
                                        Matched with {qualifiedLenders.length} Lenders
                                    </div>
                                </div>

                                <div className={styles.fundingPotential}>
                                    <span className={styles.fundingLabel}>Estimated Funding Potential</span>
                                    <span className={styles.fundingAmount}>
                                        Up to ${fundingPotential.toLocaleString()}
                                    </span>
                                </div>

                                <p className={styles.ctaText}>
                                    Great news! Your profile is strong. We found lenders ready to fund your <strong>{formData.purpose}</strong> needs.
                                </p>

                                <div className={styles.lenderPreview}>
                                    <span className={styles.previewLabel}>Top Matches:</span>
                                    <div className={styles.logoRow}>
                                        {qualifiedLenders.slice(0, 3).map(l => (
                                            <span key={l.lender_name} className={styles.lenderTag}>{l.lender_name}</span>
                                        ))}
                                        {qualifiedLenders.length > 3 && <span className={styles.moreTag}>+{qualifiedLenders.length - 3} more</span>}
                                    </div>
                                </div>

                                <button className={styles.applyButton}>
                                    Get Funded Now
                                </button>
                            </div>
                        ) : (
                            <div className={styles.failureMessage}>
                                <h3 className={styles.resultTitle}>Fundability Improvement Needed</h3>
                                <p>Based on your current inputs, we couldn't match you with our automated lender list.</p>
                                <div style={{ marginTop: '1rem', textAlign: 'left', background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #fee2e2' }}>
                                    <strong>Recommendations:</strong>
                                    <ul style={{ paddingLeft: '1.2rem', marginTop: '0.5rem', color: '#b91c1c' }}>
                                        {Number(formData.creditScore) < 600 && <li>Your <strong>Credit Score</strong> ({formData.creditScore}) is a primary factor. Consider credit repair.</li>}
                                        {parseInt(formData.timeInBusiness) < 6 && <li><strong>Time in Business</strong> is low. Many lenders require 6+ months.</li>}
                                        {parseInt(formData.revenue) < 15000 && <li><strong>Revenue</strong> is below typical minimums ($15k/mo).</li>}
                                        {formData.bankruptcy === 'yes' && <li><strong>Recent Bankruptcy</strong> restricts most automated lenders.</li>}
                                        {/* Add a generic item if no specific issues triggered, or always show advisor option */}
                                        <li>You may still qualify for <strong>Micro-loans</strong> or <strong>Startup Funding</strong> via an advisor.</li>
                                    </ul>
                                </div>
                                <button className={styles.applyButton} style={{ marginTop: '1.5rem', background: '#4b5563' }}>
                                    Talk to an Advisor
                                </button>
                            </div>
                        )}

                        <p className={styles.disclaimer}>
                            * Estimations are based on provided data. Subject to underwriting approval.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
