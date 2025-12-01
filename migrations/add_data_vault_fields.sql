-- Migration: Add Data Vault Form Fields to client_data_vault
-- This adds the columns needed to store EIN, SSN, and signature data

ALTER TABLE client_data_vault
ADD COLUMN IF NOT EXISTS ein TEXT,
ADD COLUMN IF NOT EXISTS ssn TEXT,
ADD COLUMN IF NOT EXISTS applicant_1_signature TEXT,
ADD COLUMN IF NOT EXISTS co_applicant_signature TEXT,
ADD COLUMN IF NOT EXISTS data_vault_submitted_at TIMESTAMPTZ;

-- Add comment to document the purpose
COMMENT ON COLUMN client_data_vault.ein IS 'Employer Identification Number';
COMMENT ON COLUMN client_data_vault.ssn IS 'Social Security Number (encrypted/hashed recommended)';
COMMENT ON COLUMN client_data_vault.applicant_1_signature IS 'Base64 encoded signature image for primary applicant';
COMMENT ON COLUMN client_data_vault.co_applicant_signature IS 'Base64 encoded signature image for co-applicant';
COMMENT ON COLUMN client_data_vault.data_vault_submitted_at IS 'Timestamp when the data vault form was submitted';
