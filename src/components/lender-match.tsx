"use client";

/**
 * LenderMatch.tsx
 * ───────────────
 * Standalone lender-criteria matching component.
 * Use AFTER a bank analysis is complete by passing a DealSummary object.
 *
 * Usage:
 *   import LenderMatch from "@/components/LenderMatch";
 *   import type { DealSummary } from "@/components/BankAnalysis";
 *
 *   <LenderMatch deal={dealSummary} />
 *
 * All deal data (FICO, revenue, TIB, positions, etc.) flows in via props.
 * State and Industry can also be pre-populated from the deal or edited inline.
 */

import { useState, useMemo } from "react";
import type { DealSummary } from "./bank-analysis";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lender {
  lender_name: string;
  specialty: string | null;
  min_fico: number | null;
  min_sbss: number | null;
  time_in_business_months: number | null;
  negative_days: number | null;
  monthly_deposits: number | null;
  avg_monthly_revenue: number | null;
  avg_daily_balance: number | null;
  preferred_industries: string | null;
  restricted_industries: string | null;
  restricted_industry_exceptions: string | null;
  restricted_states: string | null;
  ownership_percentage: number | null;
  number_of_positions: number | null;
  bankruptcies: string | null;
  tax_liens_limit: number | string | null;
  min_funding: number | string | null;
  max_funding: number | string | null;
  auto_decline_reasons: string | null;
  holdback_percentage: number | null;
  payment_type: string | null;
  consolidation_positions: number | null;
  additional_info: string | null;
}

interface MatchResult {
  lender: Lender;
  passed: boolean;
  flags: string[];
  warnings: string[];
}

// ─── Lender Data ─────────────────────────────────────────────────────────────

const LENDER_DATA: Lender[] = [
  { "lender_name": "360 Equipment Financing", "specialty": "Equipment", "min_fico": null, "min_sbss": null, "time_in_business_months": null, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": "CONSTRUCTION/YELLOW IRON\nLOCAL TRANSPORTATION\nMANUFACTURING\nMEDICAL\nAUTO REPAIR\nPROFESSIONAL SERVICES\nLANDSCAPING/AGRICULTURE\nCAR HAULING\nWASTE MANAGEMENT", "restricted_industries": "Trucking, Logging", "restricted_industry_exceptions": null, "restricted_states": "AK, HI", "ownership_percentage": null, "number_of_positions": null, "bankruptcies": "No", "tax_liens_limit": 25000, "min_funding": null, "max_funding": null, "auto_decline_reasons": "Child support", "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "4 Hour Funding", "specialty": "Equipment", "min_fico": 600, "min_sbss": null, "time_in_business_months": 18, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Adult Entertainment, Aircraft, Amusement Rides/Games, ATM Machines, Cannabis Related, Logging Equipment, Trucking/Logistics, Vending Machines", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": null, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": "No mail stops, home based business", "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Alliance Funding Group", "specialty": "Equipment", "min_fico": 600, "min_sbss": 0, "time_in_business_months": 48, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Law Offices, Accounting, Adult Entertainment, Cannabis-Related, Financial Services, Gaming, Online Retailers, Trucking Owner Operators OTR", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": null, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "ALT Funding", "specialty": "MCA", "min_fico": null, "min_sbss": null, "time_in_business_months": null, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": null, "restricted_industry_exceptions": null, "restricted_states": "CA, NY", "ownership_percentage": null, "number_of_positions": 2, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Always Bank", "specialty": "SBA", "min_fico": 650, "min_sbss": 155, "time_in_business_months": null, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": null, "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": null, "bankruptcies": null, "tax_liens_limit": null, "min_funding": 150000, "max_funding": 500000, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "BC Providers", "specialty": "MCA", "min_fico": 550, "min_sbss": null, "time_in_business_months": null, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": 20000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Transportation", "restricted_industry_exceptions": null, "restricted_states": "CA", "ownership_percentage": null, "number_of_positions": null, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "BHB Funding", "specialty": "MCA", "min_fico": 560, "min_sbss": null, "time_in_business_months": 12, "negative_days": 3, "monthly_deposits": 4, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Attorneys / Law Firms Adult Entertainment Gambling Establishments Schools Non-Profits Pawn Shops Mortgage Brokers Auto Sales Car Rental", "restricted_industry_exceptions": null, "restricted_states": "CA, UT", "ownership_percentage": null, "number_of_positions": null, "bankruptcies": null, "tax_liens_limit": null, "min_funding": 5000, "max_funding": 250000, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Bitty", "specialty": "MCA", "min_fico": 500, "min_sbss": null, "time_in_business_months": 6, "negative_days": 7, "monthly_deposits": null, "avg_monthly_revenue": 5000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Accommodation Arts Entertainment Auto Dealer Bail Bonds Non-Profits Money Service Businesses", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": null, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Biz2Credit", "specialty": "MCA", "min_fico": 600, "min_sbss": null, "time_in_business_months": 24, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": 50000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "general contractors, trucking, cannabis, real estate", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 1, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Biz2Credit", "specialty": "Term Loan", "min_fico": 700, "min_sbss": null, "time_in_business_months": 24, "negative_days": 0, "monthly_deposits": 9, "avg_monthly_revenue": 45000, "avg_daily_balance": 3000, "preferred_industries": null, "restricted_industries": "Cannabis, Check Cashing, Credit Repair, Collections Agencies, ATM Machines", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 1, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": "2 last years of tax return must show profit" },
  { "lender_name": "BizPoint Capital", "specialty": "MCA", "min_fico": 500, "min_sbss": null, "time_in_business_months": 9, "negative_days": null, "monthly_deposits": 5, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": null, "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 1, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Boom Funded", "specialty": "MCA", "min_fico": 500, "min_sbss": null, "time_in_business_months": 24, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": 70000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": null, "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 2, "bankruptcies": null, "tax_liens_limit": null, "min_funding": 35000, "max_funding": 2000000, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "CAN Capital", "specialty": "MCA", "min_fico": 600, "min_sbss": null, "time_in_business_months": 36, "negative_days": null, "monthly_deposits": 3, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": "Medical, Manufacturing, Retail, Veterinary, Auto Repair, Eating & Drinking", "restricted_industries": "Cannabis, Auto Dealerships, Real Estate, Adult Entertainment, Transportation, Trucking, Non-Profit, Financial, Legal Services", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 0, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": 200000, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": "Daily and weekly", "consolidation_positions": null, "additional_info": null },
  { "lender_name": "CFG", "specialty": "MCA", "min_fico": 450, "min_sbss": null, "time_in_business_months": 6, "negative_days": 0, "monthly_deposits": null, "avg_monthly_revenue": 8000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Pawn Shops, Bail Bonds, Bankruptcy Lawyers, Stockbrokers, Crypto, Used Auto, New Auto, Payday loan, Any company that loans money", "restricted_industry_exceptions": null, "restricted_states": "CA", "ownership_percentage": null, "number_of_positions": 3, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Credibly", "specialty": "MCA", "min_fico": 550, "min_sbss": null, "time_in_business_months": 6, "negative_days": 7, "monthly_deposits": null, "avg_monthly_revenue": 25000, "avg_daily_balance": 1000, "preferred_industries": null, "restricted_industries": null, "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": null, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "East Shore", "specialty": "MCA", "min_fico": 500, "min_sbss": null, "time_in_business_months": 0, "negative_days": 7, "monthly_deposits": null, "avg_monthly_revenue": 10000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": null, "restricted_industry_exceptions": null, "restricted_states": "CA, UT, VA, NY", "ownership_percentage": null, "number_of_positions": null, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "EFT", "specialty": "MCA", "min_fico": 480, "min_sbss": null, "time_in_business_months": 6, "negative_days": 3, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": 1000, "preferred_industries": null, "restricted_industries": "Auto Sales, Gyms, Nightclubs, Bars, Movie Theaters, Restaurants, Travel, Trucking, Bail bonds, Gun shops, Farms", "restricted_industry_exceptions": null, "restricted_states": "CA, UT, VA", "ownership_percentage": null, "number_of_positions": 3, "bankruptcies": null, "tax_liens_limit": null, "min_funding": 15000, "max_funding": 25000, "auto_decline_reasons": "MCA default", "holdback_percentage": null, "payment_type": "Daily and Weekly", "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Essential Funding", "specialty": "MCA", "min_fico": 0, "min_sbss": null, "time_in_business_months": 12, "negative_days": 6, "monthly_deposits": 3, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Casinos, Collection agencies, Ammunition, Law Firms, Sales Organizations, Travel Agencies, Adult Entertainment, Cannabis, Bail Bonds, Real Estate", "restricted_industry_exceptions": "Trucking, transportation, construction, car sales", "restricted_states": "NY, UT, CA, PR", "ownership_percentage": null, "number_of_positions": 3, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Everest", "specialty": "MCA", "min_fico": 550, "min_sbss": null, "time_in_business_months": 3, "negative_days": 5, "monthly_deposits": null, "avg_monthly_revenue": 5000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Financial, Auto Sales, Attorneys", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 2, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "FastCapital", "specialty": "MCA", "min_fico": null, "min_sbss": null, "time_in_business_months": 12, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": null, "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 2, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": 1, "additional_info": null },
  { "lender_name": "FMS Advance", "specialty": "MCA", "min_fico": 500, "min_sbss": null, "time_in_business_months": 12, "negative_days": 5, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Law Firms, Collection Agencies, Mortgage Companies, Real Estate, Financial institutions, Nonprofit, Auto Sales", "restricted_industry_exceptions": null, "restricted_states": "ND, CA, VA, HI, PR", "ownership_percentage": null, "number_of_positions": 2, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": 750000, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Forward Financing", "specialty": "MCA", "min_fico": 500, "min_sbss": null, "time_in_business_months": 12, "negative_days": 5, "monthly_deposits": null, "avg_monthly_revenue": 10000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Adult entertainment, Auto sales, Cannabis, Non-profit, Drug paraphernalia, Firearms, Lending or financing firms, Debt collection, Real estate investment, Check cashing", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 0, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Fox", "specialty": "MCA", "min_fico": 600, "min_sbss": null, "time_in_business_months": 6, "negative_days": 7, "monthly_deposits": null, "avg_monthly_revenue": 100000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Debt collectors, credit counselors, trucking, non-profits, law firms", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 3, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Funding Metrics", "specialty": "MCA", "min_fico": 0, "min_sbss": null, "time_in_business_months": null, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": null, "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 3, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Fundkite", "specialty": "MCA", "min_fico": 600, "min_sbss": null, "time_in_business_months": 12, "negative_days": 5, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Banks, Credit Unions, Money Services, Bail Bonding, Factoring, Financial Transaction Processing, Credit Protection, Collection Agencies, Churches", "restricted_industry_exceptions": null, "restricted_states": "CA", "ownership_percentage": null, "number_of_positions": 2, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Fundr", "specialty": "MCA", "min_fico": 500, "min_sbss": null, "time_in_business_months": null, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": 15000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Casinos, holding companies, RE, Non-profits, check cashing, attorneys, automobile dealers", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 3, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "GM Funding", "specialty": "MCA", "min_fico": 660, "min_sbss": null, "time_in_business_months": 3, "negative_days": 2, "monthly_deposits": 5, "avg_monthly_revenue": 15000, "avg_daily_balance": 1000, "preferred_industries": null, "restricted_industries": "Farming, New home construction, Used cars, Real estate, Travel agencies, Gun stores, Banking, Cannabis", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": 0.5, "number_of_positions": 4, "bankruptcies": "No", "tax_liens_limit": "Over 100k must be on a payment plan", "min_funding": 50000, "max_funding": 150000, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "IBF", "specialty": "SBA", "min_fico": 640, "min_sbss": 165, "time_in_business_months": null, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": null, "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 2, "bankruptcies": null, "tax_liens_limit": null, "min_funding": 15000, "max_funding": 50000, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": "Monthly", "consolidation_positions": null, "additional_info": null },
  { "lender_name": "IDEA", "specialty": "LOC", "min_fico": 660, "min_sbss": 0, "time_in_business_months": 36, "negative_days": 3, "monthly_deposits": 8, "avg_monthly_revenue": 15000, "avg_daily_balance": 5000, "preferred_industries": null, "restricted_industries": "No sole proprietorships or non-profits", "restricted_industry_exceptions": null, "restricted_states": "VT, SD, ND", "ownership_percentage": 0.5, "number_of_positions": 2, "bankruptcies": "No", "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": "No sole proprietorships or non-profits", "holdback_percentage": null, "payment_type": "Weekly", "consolidation_positions": null, "additional_info": null },
  { "lender_name": "JW Capital", "specialty": "MCA", "min_fico": 0, "min_sbss": null, "time_in_business_months": 12, "negative_days": 0, "monthly_deposits": null, "avg_monthly_revenue": 50000, "avg_daily_balance": null, "preferred_industries": "trucking, commercial construction, healthcare", "restricted_industries": "Auto", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 2, "bankruptcies": "yes", "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": "Doesn't fund 1st position" },
  { "lender_name": "Kalamata", "specialty": "MCA", "min_fico": 600, "min_sbss": null, "time_in_business_months": 12, "negative_days": 5, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Insurance, Property Management, Staffing, Home Based Businesses, Construction, Adult Entertainment, Gas Stations, Marijuana, Guns, Legal Services, Non-Profit, Pawn Shops, Auto Sales, Transportation, Real Estate", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 0, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "LCF", "specialty": "MCA", "min_fico": 0, "min_sbss": null, "time_in_business_months": 3, "negative_days": 4, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": null, "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 0, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Lendini", "specialty": "MCA", "min_fico": 500, "min_sbss": null, "time_in_business_months": 8, "negative_days": 6, "monthly_deposits": null, "avg_monthly_revenue": 5000, "avg_daily_balance": 500, "preferred_industries": null, "restricted_industries": "Attorneys, Auto Sales, Check Cashing, Collection Agency, Credit Repair, Crypto, Real Estate, Transportation, Gun Dealers, Insurance, Marijuana, Non-Profit", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 2, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "LG Funding", "specialty": "MCA", "min_fico": 0, "min_sbss": null, "time_in_business_months": null, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Trucking", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 1, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Libertas", "specialty": "MCA", "min_fico": 650, "min_sbss": null, "time_in_business_months": 48, "negative_days": 5, "monthly_deposits": 8, "avg_monthly_revenue": 150000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Trucking, Auto, Finance, Mortgage brokers, cash businesses", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 0, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Liquidibee", "specialty": "MCA", "min_fico": 525, "min_sbss": null, "time_in_business_months": null, "negative_days": 5, "monthly_deposits": null, "avg_monthly_revenue": 25000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": null, "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": 0.51, "number_of_positions": 0, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": 500000, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Maverick Funding", "specialty": "MCA", "min_fico": 540, "min_sbss": null, "time_in_business_months": 9, "negative_days": null, "monthly_deposits": 5, "avg_monthly_revenue": 60000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Trucking, Transportation", "restricted_industry_exceptions": null, "restricted_states": "PR, HI", "ownership_percentage": null, "number_of_positions": 4, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Mint", "specialty": "MCA", "min_fico": 0, "min_sbss": null, "time_in_business_months": 9, "negative_days": 5, "monthly_deposits": 3, "avg_monthly_revenue": 25000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Financial Services, Law Firms, Auto Sales, Real Estate, Non-Profit, Cannabis, Solar, Staffing", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": null, "bankruptcies": null, "tax_liens_limit": null, "min_funding": 5000, "max_funding": 2500000, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": "Weekly", "consolidation_positions": null, "additional_info": null },
  { "lender_name": "MNR", "specialty": "MCA", "min_fico": 550, "min_sbss": null, "time_in_business_months": 14, "negative_days": 6, "monthly_deposits": 7, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Auto Sales, Brokerages, Check Cashing, Adult Entertainment, Lawyers and Legal offices", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": null, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": 500000, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Nebula", "specialty": "MCA", "min_fico": 620, "min_sbss": null, "time_in_business_months": 12, "negative_days": 3, "monthly_deposits": null, "avg_monthly_revenue": 45000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Gaming, Non-Profits, Day Trading, Mortgage Brokers, Check Cashing, Adult Entertainment, Collection Agencies", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": null, "bankruptcies": null, "tax_liens_limit": null, "min_funding": 10000, "max_funding": 5000000, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "NewCo", "specialty": "MCA", "min_fico": 550, "min_sbss": null, "time_in_business_months": 12, "negative_days": 5, "monthly_deposits": 4, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": null, "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 3, "bankruptcies": null, "tax_liens_limit": null, "min_funding": 10000, "max_funding": 750000, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": "Daily, Weekly", "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Newity", "specialty": "SBA", "min_fico": 660, "min_sbss": 165, "time_in_business_months": null, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "RE", "restricted_industry_exceptions": null, "restricted_states": "PR", "ownership_percentage": null, "number_of_positions": null, "bankruptcies": null, "tax_liens_limit": "No", "min_funding": null, "max_funding": 500000, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "PDM Capital", "specialty": "MCA", "min_fico": 500, "min_sbss": null, "time_in_business_months": 8, "negative_days": null, "monthly_deposits": 3, "avg_monthly_revenue": 30000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": null, "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 3, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "QFS", "specialty": "Reverse consolidation", "min_fico": 500, "min_sbss": 0, "time_in_business_months": 12, "negative_days": 5, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": null, "restricted_industry_exceptions": null, "restricted_states": "CA", "ownership_percentage": null, "number_of_positions": 1, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Rapid Finance", "specialty": "MCA", "min_fico": 600, "min_sbss": null, "time_in_business_months": 36, "negative_days": 0, "monthly_deposits": null, "avg_monthly_revenue": 10000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Adult Entertainment, Auto Dealers, Bail Bonds, Law Firms, Marijuana, Casinos, Non-Profit, Real Estate Investors, Vape Shops", "restricted_industry_exceptions": "Gas Stations, Insurance Agencies, Property Management, Staffing Companies", "restricted_states": "NJ, MT, NV, RI, VT", "ownership_percentage": null, "number_of_positions": 2, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Revenued", "specialty": "MCA", "min_fico": 400, "min_sbss": null, "time_in_business_months": 6, "negative_days": 3, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": 1000, "preferred_industries": null, "restricted_industries": "Transportation, Used Car Sales, Sole Proprietorships", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 2, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Skyinance", "specialty": "MCA", "min_fico": 0, "min_sbss": null, "time_in_business_months": null, "negative_days": 0, "monthly_deposits": null, "avg_monthly_revenue": null, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Auto Sales, check cashing, bail bonds, Financial Services", "restricted_industry_exceptions": null, "restricted_states": "CA, VA, UT", "ownership_percentage": null, "number_of_positions": 3, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "The Fundworks", "specialty": "MCA", "min_fico": 550, "min_sbss": null, "time_in_business_months": 12, "negative_days": 8, "monthly_deposits": 4, "avg_monthly_revenue": 10000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Adult Entertainment, Attorneys, Bail Bonds, Collection, Marijuana, Real Estate Investment, Trucking, Used Auto Dealerships", "restricted_industry_exceptions": "New Automobile Dealerships, Construction, Gas Stations, Import/Export", "restricted_states": null, "ownership_percentage": null, "number_of_positions": 0, "bankruptcies": null, "tax_liens_limit": null, "min_funding": 10000, "max_funding": null, "auto_decline_reasons": "Criminal record of fraud, Manipulated documents, Judgments from other funding companies", "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "TVT Capital", "specialty": "MCA", "min_fico": null, "min_sbss": null, "time_in_business_months": null, "negative_days": 0, "monthly_deposits": null, "avg_monthly_revenue": 75000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "No start ups", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 3, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Vader", "specialty": "MCA", "min_fico": 500, "min_sbss": null, "time_in_business_months": 1, "negative_days": 7, "monthly_deposits": null, "avg_monthly_revenue": 4000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Financial, Auto Sales, Attorneys", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 3, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Vault", "specialty": "MCA", "min_fico": 500, "min_sbss": null, "time_in_business_months": 12, "negative_days": 6, "monthly_deposits": null, "avg_monthly_revenue": 30000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "auto sales, debt collection, Finance, entertainment companies", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 7, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Velocity Capital Group", "specialty": "MCA", "min_fico": 550, "min_sbss": null, "time_in_business_months": 12, "negative_days": 2, "monthly_deposits": 3, "avg_monthly_revenue": 20000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Construction 1st position, Bail Bonds, Gas Stations, Law Firms, Logistics, Trucking, Vehicle/Auto Dealer, Real Estate, Staffing, Vape Shops, Pawn Shops, Solar", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 4, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": "Less than 3 Monthly Deposits, Deposit Volume under $20K, Open Bankruptcies, Excessive NSFs, Fraudulent Documentation", "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Vital Cap", "specialty": "MCA", "min_fico": 520, "min_sbss": null, "time_in_business_months": 12, "negative_days": 3, "monthly_deposits": 5, "avg_monthly_revenue": 20000, "avg_daily_balance": null, "preferred_industries": "Restaurants, Wholesalers, Liquor Stores, Retail, Medical, Manufacturers", "restricted_industries": "Financial Institutions, Collection agencies, Gas station, Used/new auto, Trucking", "restricted_industry_exceptions": null, "restricted_states": "VA, CA", "ownership_percentage": 0.6, "number_of_positions": 2, "bankruptcies": "Chapter 7 must be discharged, Chapter 13 must be discharged", "tax_liens_limit": "Personal up to 200k", "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Vox Funding", "specialty": "MCA", "min_fico": null, "min_sbss": null, "time_in_business_months": null, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": 15000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "Adult Entertainment, Pawn Shop, Check Cashiers, Sole proprietors, Used Car Dealerships, Wire Transfer Companies", "restricted_industry_exceptions": "Trucking: $150,000 minimum", "restricted_states": null, "ownership_percentage": null, "number_of_positions": 3, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": 1500000, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": null, "consolidation_positions": null, "additional_info": null },
  { "lender_name": "Wing Lake", "specialty": "Consolidation", "min_fico": null, "min_sbss": 0, "time_in_business_months": null, "negative_days": null, "monthly_deposits": null, "avg_monthly_revenue": 300000, "avg_daily_balance": null, "preferred_industries": null, "restricted_industries": "oil and gas", "restricted_industry_exceptions": null, "restricted_states": null, "ownership_percentage": null, "number_of_positions": 2, "bankruptcies": null, "tax_liens_limit": null, "min_funding": null, "max_funding": null, "auto_decline_reasons": null, "holdback_percentage": null, "payment_type": "Monthly", "consolidation_positions": null, "additional_info": null },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt$ = (v: number) =>
  v === 0 ? "—" : "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const SPECIALTY_COLORS: Record<string, string> = {
  MCA: "bg-blue-900/40 text-blue-300 border-blue-700/40",
  SBA: "bg-green-900/40 text-green-300 border-green-700/40",
  LOC: "bg-purple-900/40 text-purple-300 border-purple-700/40",
  Equipment: "bg-yellow-900/40 text-yellow-300 border-yellow-700/40",
  "Term Loan": "bg-orange-900/40 text-orange-300 border-orange-700/40",
  "Real Estate": "bg-cyan-900/40 text-cyan-300 border-cyan-700/40",
  Trucking: "bg-red-900/40 text-red-300 border-red-700/40",
  "Invoice Factoring": "bg-pink-900/40 text-pink-300 border-pink-700/40",
  Consolidation: "bg-indigo-900/40 text-indigo-300 border-indigo-700/40",
  "Reverse consolidation": "bg-teal-900/40 text-teal-300 border-teal-700/40",
};

// ─── Matching Engine ──────────────────────────────────────────────────────────

function matchLender(lender: Lender, deal: DealSummary): MatchResult {
  const flags: string[] = [];
  const warnings: string[] = [];

  if (lender.min_fico && lender.min_fico > 0 && deal.fico > 0 && deal.fico < lender.min_fico)
    flags.push(`FICO ${deal.fico} < min ${lender.min_fico}`);

  if (lender.time_in_business_months && lender.time_in_business_months > 0 && deal.tibMonths > 0 && deal.tibMonths < lender.time_in_business_months)
    flags.push(`TIB ${deal.tibMonths}mo < min ${lender.time_in_business_months}mo`);

  if (lender.avg_monthly_revenue && deal.avgRevenue > 0 && deal.avgRevenue < lender.avg_monthly_revenue)
    flags.push(`Revenue ${fmt$(deal.avgRevenue)} < min ${fmt$(lender.avg_monthly_revenue)}`);

  if (lender.negative_days !== null && deal.totalNegDays > 0 && deal.totalNegDays > lender.negative_days)
    flags.push(`Neg days ${deal.totalNegDays} > max ${lender.negative_days}`);

  if (lender.number_of_positions !== null && deal.numOpenPositions > 0 && deal.numOpenPositions > lender.number_of_positions)
    flags.push(`${deal.numOpenPositions} positions > max ${lender.number_of_positions}`);

  if (lender.avg_daily_balance && deal.avgDailyBalance > 0 && deal.avgDailyBalance < lender.avg_daily_balance)
    flags.push(`Avg daily bal ${fmt$(deal.avgDailyBalance)} < min ${fmt$(lender.avg_daily_balance)}`);

  if (lender.bankruptcies === "No" && deal.hasBankruptcy)
    flags.push("Lender does not accept bankruptcies");

  if (lender.restricted_states && deal.state) {
    const stateParts = lender.restricted_states.toUpperCase().split(/[,\s]+/).filter((s) => s.length === 2);
    if (stateParts.includes(deal.state.toUpperCase()))
      flags.push(`State ${deal.state.toUpperCase()} is restricted`);
  }

  if (lender.restricted_industries && deal.industry) {
    const words = deal.industry.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const restricted = lender.restricted_industries.toLowerCase();
    const hit = words.find((w) => restricted.includes(w));
    if (hit) {
      const exception = lender.restricted_industry_exceptions?.toLowerCase() || "";
      if (!exception || !words.find((w) => exception.includes(w)))
        flags.push(`Industry "${deal.industry}" may be restricted`);
      else
        warnings.push("Industry may be restricted but exceptions exist — verify");
    }
  }

  const minF = typeof lender.min_funding === "number" ? lender.min_funding : null;
  const maxF = typeof lender.max_funding === "number" ? lender.max_funding : null;
  if (deal.capitalRequested > 0) {
    if (minF !== null && deal.capitalRequested < minF)
      flags.push(`Request ${fmt$(deal.capitalRequested)} < min ${fmt$(minF)}`);
    if (maxF !== null && deal.capitalRequested > maxF)
      flags.push(`Request ${fmt$(deal.capitalRequested)} > max ${fmt$(maxF)}`);
  }

  return { lender, passed: flags.length === 0, flags, warnings };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface LenderMatchProps {
  /** Pass a DealSummary built from a completed BankAnalysis. */
  deal: Partial<DealSummary>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LenderMatch({ deal }: LenderMatchProps) {
  // Allow inline override of state & industry in case they're not on the deal object yet
  const [state, setState] = useState(deal.state ?? "");
  const [industry, setIndustry] = useState(deal.industry ?? "");
  const [specialtyFilter, setSpecialtyFilter] = useState("All");
  const [showPassedOnly, setShowPassedOnly] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const resolvedDeal: DealSummary = {
    businessName: deal.businessName ?? "",
    ownerName: deal.ownerName ?? "",
    fico: deal.fico ?? 0,
    tibMonths: deal.tibMonths ?? 0,
    avgRevenue: deal.avgRevenue ?? 0,
    avgDailyBalance: deal.avgDailyBalance ?? 0,
    totalNegDays: deal.totalNegDays ?? 0,
    numOpenPositions: deal.numOpenPositions ?? 0,
    hasBankruptcy: deal.hasBankruptcy ?? false,
    capitalRequested: deal.capitalRequested ?? 0,
    state,
    industry,
  };

  const results = useMemo(() =>
    LENDER_DATA
      .map((l) => matchLender(l, resolvedDeal))
      .sort((a, b) => {
        if (a.passed !== b.passed) return a.passed ? -1 : 1;
        return a.flags.length - b.flags.length;
      }),
    [resolvedDeal.fico, resolvedDeal.tibMonths, resolvedDeal.avgRevenue, resolvedDeal.totalNegDays,
    resolvedDeal.numOpenPositions, resolvedDeal.avgDailyBalance, resolvedDeal.capitalRequested,
    resolvedDeal.hasBankruptcy, state, industry]
  );

  const passed = results.filter((r) => r.passed);
  const specialties = ["All", ...Array.from(new Set(LENDER_DATA.map((l) => l.specialty ?? "Unknown"))).sort()];

  const filtered = results.filter((r) => {
    if (showPassedOnly && !r.passed) return false;
    if (specialtyFilter !== "All" && (r.lender.specialty ?? "Unknown") !== specialtyFilter) return false;
    return true;
  });

  const dataEntered = resolvedDeal.fico > 0 || resolvedDeal.tibMonths > 0 || resolvedDeal.avgRevenue > 0 || state || industry;

  return (
    <div
      className="min-h-screen text-gray-100 space-y-4 p-4"
      style={{ background: "#0d1117", fontFamily: "'IBM Plex Mono', monospace" }}
    >
      {/* Header */}
      <div className="rounded-xl border border-gray-700 p-4" style={{ background: "#161b22" }}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div>
            <div className="text-xs font-bold text-gray-500 uppercase tracking-widest">Lender Match</div>
            {(resolvedDeal.businessName || resolvedDeal.ownerName) && (
              <div className="text-sm font-semibold text-gray-100 mt-0.5">
                {resolvedDeal.businessName || resolvedDeal.ownerName}
              </div>
            )}
          </div>
          {dataEntered && (
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Eligible</span>
                <span className="text-lg font-mono font-bold text-green-400">{passed.length}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Disqualified</span>
                <span className="text-lg font-mono font-bold text-red-400">{results.length - passed.length}</span>
              </div>
            </div>
          )}
        </div>

        {/* Deal summary pills */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: "FICO", value: resolvedDeal.fico > 0 ? String(resolvedDeal.fico) : null },
            { label: "TIB", value: resolvedDeal.tibMonths > 0 ? `${resolvedDeal.tibMonths}mo` : null },
            { label: "Avg Revenue", value: resolvedDeal.avgRevenue > 0 ? fmt$(resolvedDeal.avgRevenue) : null },
            { label: "Neg Days", value: resolvedDeal.totalNegDays > 0 ? String(resolvedDeal.totalNegDays) : null },
            { label: "Positions", value: resolvedDeal.numOpenPositions > 0 ? String(resolvedDeal.numOpenPositions) : null },
            { label: "Requested", value: resolvedDeal.capitalRequested > 0 ? fmt$(resolvedDeal.capitalRequested) : null },
            { label: "Bankruptcy", value: resolvedDeal.hasBankruptcy ? "Yes" : null },
          ].filter((p) => p.value !== null).map(({ label, value }) => (
            <div key={label} className="flex items-center gap-1.5 bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1">
              <span className="text-xs text-gray-500">{label}</span>
              <span className="text-xs font-mono font-bold text-blue-400">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Override inputs — state & industry */}
      <div className="rounded-xl border border-gray-700 p-4" style={{ background: "#161b22" }}>
        <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Match Filters</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Business State</label>
            <input
              type="text"
              value={state}
              onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
              placeholder="FL"
              className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono text-gray-100 uppercase focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Industry / Business Type</label>
            <input
              type="text"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. Restaurant, Trucking..."
              className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono text-gray-100 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Match bar */}
      {dataEntered && (
        <div className="rounded-xl border border-gray-700 p-4" style={{ background: "#161b22" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 uppercase tracking-widest">Eligibility</span>
            <span className="text-xs font-mono text-gray-400">
              {results.length > 0 ? Math.round((passed.length / results.length) * 100) : 0}% of lenders
            </span>
          </div>
          <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-green-500 to-blue-500 transition-all duration-500"
              style={{ width: `${results.length > 0 ? (passed.length / results.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {!dataEntered && (
        <div className="rounded-lg border border-blue-800/40 bg-blue-900/10 px-4 py-3 text-xs text-blue-400 font-mono">
          💡 Pass a <code>DealSummary</code> from a completed BankAnalysis to run matching. Enter State and Industry above to apply geographic/industry filters.
        </div>
      )}

      {/* Specialty tabs + filter toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        {specialties.map((s) => (
          <button
            key={s}
            onClick={() => setSpecialtyFilter(s)}
            className={`px-2.5 py-1 text-xs font-mono uppercase tracking-wider rounded border transition-all ${specialtyFilter === s
                ? "bg-blue-600 border-blue-600 text-white"
                : "border-gray-700 text-gray-500 hover:border-blue-600 hover:text-blue-400"
              }`}
          >
            {s}
          </button>
        ))}
        <button
          onClick={() => setShowPassedOnly(!showPassedOnly)}
          className={`px-3 py-1 text-xs font-mono uppercase tracking-wider rounded border transition-all ${showPassedOnly
              ? "bg-green-900/30 border-green-600/60 text-green-400"
              : "border-gray-700 text-gray-500 hover:text-green-400"
            }`}
        >
          {showPassedOnly ? "✓ Eligible Only" : "Show All"}
        </button>
        <span className="text-xs text-gray-600 font-mono ml-auto">{filtered.length} shown</span>
      </div>

      {/* Lender cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {filtered.map((result, i) => {
          const key = `${result.lender.lender_name}-${result.lender.specialty}-${i}`;
          const isExpanded = expandedKey === key;
          const specColor = SPECIALTY_COLORS[result.lender.specialty ?? ""] ?? "bg-gray-900/40 text-gray-400 border-gray-700/40";
          const minF = typeof result.lender.min_funding === "number" ? result.lender.min_funding : null;
          const maxF = typeof result.lender.max_funding === "number" ? result.lender.max_funding : null;

          return (
            <div
              key={key}
              className={`rounded-xl border transition-all ${result.passed
                  ? "border-green-800/40 hover:border-green-600/60"
                  : "border-gray-800 hover:border-red-800/40"
                }`}
              style={{ background: result.passed ? "#161b22" : "#13191f" }}
            >
              <div
                className="flex items-start gap-3 px-3 py-3 cursor-pointer"
                onClick={() => setExpandedKey(isExpanded ? null : key)}
              >
                <div
                  className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${result.passed ? "bg-green-400" : "bg-red-500"}`}
                  style={{ boxShadow: result.passed ? "0 0 6px #4ade80" : "0 0 6px #f87171" }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-100 font-mono">{result.lender.lender_name}</span>
                    {result.lender.specialty && (
                      <span className={`text-xs font-mono border rounded px-1.5 py-0.5 ${specColor}`}>
                        {result.lender.specialty}
                      </span>
                    )}
                    {(minF || maxF) && (
                      <span className="text-xs text-gray-500 font-mono">
                        {minF ? `$${(minF / 1000).toFixed(0)}K` : ""}
                        {minF && maxF ? " – " : ""}
                        {maxF ? `$${(maxF / 1000).toFixed(0)}K` : ""}
                      </span>
                    )}
                  </div>
                  {result.passed && result.warnings.length === 0 && (
                    <div className="text-xs text-green-400 mt-0.5">✓ Meets all entered criteria</div>
                  )}
                  {result.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {result.flags.slice(0, 2).map((f, fi) => (
                        <span key={fi} className="text-xs bg-red-900/20 border border-red-800/40 text-red-400 rounded px-1.5 py-0.5 font-mono">
                          {f}
                        </span>
                      ))}
                      {result.flags.length > 2 && (
                        <span className="text-xs text-gray-500 font-mono">+{result.flags.length - 2} more</span>
                      )}
                    </div>
                  )}
                  {result.warnings.map((w, wi) => (
                    <div key={wi} className="text-xs text-orange-400 mt-0.5">⚠ {w}</div>
                  ))}
                </div>
                <span className="text-gray-600 text-xs flex-shrink-0 mt-1">{isExpanded ? "▲" : "▼"}</span>
              </div>

              {isExpanded && (
                <div className="px-3 pb-3 border-t border-gray-800 pt-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {([
                      ["Min FICO", result.lender.min_fico ?? "—"],
                      ["Min TIB", result.lender.time_in_business_months ? `${result.lender.time_in_business_months}mo` : "—"],
                      ["Min Revenue", result.lender.avg_monthly_revenue ? fmt$(result.lender.avg_monthly_revenue) : "—"],
                      ["Max Neg Days", result.lender.negative_days ?? "—"],
                      ["Max Positions", result.lender.number_of_positions ?? "—"],
                      ["Payment Type", result.lender.payment_type ?? "—"],
                      ["Bankruptcies OK", result.lender.bankruptcies ?? "—"],
                      ["Restricted States", result.lender.restricted_states || "None"],
                    ] as [string, string | number][]).map(([label, val]) => (
                      <div key={label} className="flex justify-between gap-2 bg-gray-950 rounded px-2 py-1">
                        <span className="text-gray-500">{label}</span>
                        <span className="text-gray-200 font-mono text-right">{String(val)}</span>
                      </div>
                    ))}
                  </div>
                  {result.lender.preferred_industries && (
                    <div className="bg-gray-950 rounded px-2 py-2">
                      <div className="text-xs text-green-600 uppercase tracking-wider mb-1">Preferred Industries</div>
                      <div className="text-xs text-gray-300 leading-relaxed">{result.lender.preferred_industries}</div>
                    </div>
                  )}
                  {result.lender.restricted_industries && (
                    <div className="bg-gray-950 rounded px-2 py-2">
                      <div className="text-xs text-red-600 uppercase tracking-wider mb-1">Restricted Industries</div>
                      <div className="text-xs text-gray-300 leading-relaxed">{result.lender.restricted_industries}</div>
                    </div>
                  )}
                  {result.lender.restricted_industry_exceptions && (
                    <div className="bg-gray-950 rounded px-2 py-2">
                      <div className="text-xs text-orange-500 uppercase tracking-wider mb-1">Exceptions</div>
                      <div className="text-xs text-gray-300 leading-relaxed">{result.lender.restricted_industry_exceptions}</div>
                    </div>
                  )}
                  {result.lender.additional_info && (
                    <div className="bg-gray-950 rounded px-2 py-2">
                      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Additional Notes</div>
                      <div className="text-xs text-gray-300 leading-relaxed">{result.lender.additional_info}</div>
                    </div>
                  )}
                  {result.flags.length > 0 && (
                    <div className="space-y-1">
                      {result.flags.map((f, fi) => (
                        <div key={fi} className="text-xs bg-red-900/20 border border-red-800/40 text-red-400 rounded px-2 py-1 font-mono">
                          ✗ {f}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
