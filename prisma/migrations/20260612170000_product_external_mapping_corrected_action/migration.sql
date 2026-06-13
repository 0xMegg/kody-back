-- Add dedicated audit action for ProductExternalMapping correction.
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'PRODUCT_EXTERNAL_MAPPING_CORRECTED';
