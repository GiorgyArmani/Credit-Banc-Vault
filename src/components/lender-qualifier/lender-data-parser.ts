/**
 * Parser utility to convert Excel spreadsheet data into LenderCriteria objects
 * This reads the uploaded spreadsheet and transforms it into a usable format
 */

import type { LenderCriteria } from '../../types/lender-qualifier-types';

/**
 * Parses a cell value and converts it to the appropriate type
 * Handles null/empty values, numbers, and strings
 */
function parseCellValue(value: any): string | number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return String(value).trim();
}

/**
 * Converts "Yes"/"No" string to boolean or null
 * Used for fields like allows_bankruptcies
 */
function parseBooleanField(value: any): boolean | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const str = String(value).trim().toLowerCase();
  if (str === 'yes' || str === 'true') {
    return true;
  }
  if (str === 'no' || str === 'false') {
    return false;
  }
  return null;
}

/**
 * Parses numeric value with null handling
 * Converts string numbers to actual numbers
 */
function parseNumericField(value: any): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  const parsed = parseFloat(String(value));
  return isNaN(parsed) ? null : parsed;
}

/**
 * Parses a row from the spreadsheet into a LenderCriteria object
 * Maps spreadsheet columns to the structured format
 */
export function parseLenderRow(row: any[]): LenderCriteria | null {
  // Skip if no lender name
  if (!row[0]) {
    return null;
  }
  
  return {
    lender_name: String(row[0]).trim(),
    specialty: parseCellValue(row[1]) as string | null,
    min_fico: parseNumericField(row[2]),
    min_sbss: parseNumericField(row[3]),
    time_in_business_months: parseNumericField(row[4]),
    negative_days: parseNumericField(row[5]),
    monthly_deposits_required: parseNumericField(row[6]),
    average_monthly_revenue: parseNumericField(row[7]),
    average_daily_balances: parseNumericField(row[8]),
    preferred_industries: parseCellValue(row[9]) as string | null,
    restricted_industries: parseCellValue(row[10]) as string | null,
    restricted_industry_exceptions: parseCellValue(row[12]) as string | null,
    restricted_states: parseCellValue(row[13]) as string | null,
    ownership_requirement_pct: parseNumericField(row[14]),
    number_of_positions: parseNumericField(row[15]),
    allows_bankruptcies: parseBooleanField(row[16]),
    tax_liens_limit: parseNumericField(row[17]),
    min_funding_size: parseNumericField(row[18]),
    max_funding_size: parseNumericField(row[19]),
    auto_decline_reasons: parseCellValue(row[20]) as string | null,
    holdback_percentage: parseCellValue(row[21]) as string | null,
    payment_type: parseCellValue(row[22]) as string | null,
    consolidation_positions: parseNumericField(row[24]),
    additional_information: parseCellValue(row[25]) as string | null,
  };
}

/**
 * Server-side function to read and parse the Excel file
 * This would typically run in a Node.js environment
 */
export async function parseLenderSpreadsheetServer(
  file_path: string
): Promise<LenderCriteria[]> {
  // This is a Node.js implementation using xlsx library
  const XLSX = require('xlsx');
  
  const workbook = XLSX.readFile(file_path);
  const sheet_name = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheet_name];
  
  // Convert to JSON array
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1,
    raw: false 
  });
  
  const lenders: LenderCriteria[] = [];
  
  // Skip header row (index 0), start from row 1
  for (let i = 1; i < data.length; i++) {
    const lender = parseLenderRow(data[i]);
    if (lender) {
      lenders.push(lender);
    }
  }
  
  return lenders;
}

/**
 * Client-side function to parse uploaded Excel file
 * Uses the File API in the browser
 */
export async function parseLenderSpreadsheetClient(
  file: File
): Promise<LenderCriteria[]> {
  // This would use a client-side xlsx parser like SheetJS
  const XLSX = await import('xlsx');
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        // Convert ArrayBuffer to binary string
        let binary = '';
        const bytes = new Uint8Array(arrayBuffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const workbook = XLSX.read(binary, { type: 'binary' });
        const sheet_name = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheet_name];
        
        // Convert to array format
        const rows = XLSX.utils.sheet_to_json(worksheet, { 
          header: 1,
          raw: false 
        });
        
        const lenders: LenderCriteria[] = [];
        
        // Skip header row
        for (let i = 1; i < rows.length; i++) {
          const lender = parseLenderRow(rows[i] as any[]);
          if (lender) {
            lenders.push(lender);
          }
        }
        
        resolve(lenders);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Converts LenderCriteria array to JSON for caching/storage
 * Useful for storing parsed data in localStorage or database
 */
export function lendersToJson(lenders: LenderCriteria[]): string {
  return JSON.stringify(lenders, null, 2);
}

/**
 * Loads LenderCriteria from JSON string
 * Counterpart to lenders-to-json for data retrieval
 */
export function lendersFromJson(json: string): LenderCriteria[] {
  return JSON.parse(json);
}
