-- Migration 0018: Onboarding system
--
-- invited_at — ISO-8601 timestamp set when an invite email is successfully
--              delivered via the /api/onboarding/invite endpoint.
--              NULL means the user was created before the onboarding system
--              existed, or was invited without email.

ALTER TABLE users ADD COLUMN invited_at TEXT;
