-- Historical preflight for the previous cleanup. The complete relationship
-- migration is now in 20260806_schema_refactor.sql; run that script for a
-- legacy database instead of running this file in isolation.
BEGIN;

DROP TABLE IF EXISTS "Categories";
DROP INDEX IF EXISTS "IX_Assets_LegacyKey";

ALTER TABLE IF EXISTS "Assets" DROP COLUMN IF EXISTS "LegacyKey";
ALTER TABLE IF EXISTS "ClassificationGroups" DROP COLUMN IF EXISTS "Role";
ALTER TABLE IF EXISTS "ClassificationValues" DROP COLUMN IF EXISTS "DefaultLiquidityKey";

COMMIT;
