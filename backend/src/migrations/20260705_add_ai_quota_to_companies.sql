-- add ai_monthly_token_limit to companies so orgs can have per-company quotas

ALTER TABLE companies
ADD COLUMN IF NOT EXISTS ai_monthly_token_limit INTEGER DEFAULT NULL;
