-- Wealth Watcher schema refactor
--
-- Run this once against a database created by the pre-refactor model, after a
-- backup and during a maintenance window. The generated EF migration creates
-- the same target model for new databases; this script is the data-preserving
-- bridge for an existing database that has tables such as WealthEntries,
-- ClassificationValues, ProviderAssetLinks, and Settings.
--
-- It deliberately fails early when the legacy tables are not present. That
-- prevents a clean target database from being mistaken for a legacy database.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    IF to_regclass('public."Assets"') IS NULL
       OR to_regclass('public."WealthEntries"') IS NULL
       OR to_regclass('public."IntegrationConnections"') IS NULL
       OR to_regclass('public."IntegrationAccounts"') IS NULL
    THEN
        RAISE EXCEPTION 'Expected the pre-refactor Wealth Watcher schema; run the EF migration for a new database.';
    END IF;
END $$;

-- Dimensions and explicit relationship tables.
CREATE TABLE IF NOT EXISTS "AssetGroups" (
    "Id" uuid PRIMARY KEY,
    "Code" text NOT NULL,
    "DisplayName" text NOT NULL,
    "Color" text NOT NULL,
    "DisplayOrder" integer NOT NULL,
    "IsSystem" boolean NOT NULL,
    "ArchivedAt" timestamptz NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "IX_AssetGroups_Code" ON "AssetGroups" ("Code");

CREATE TABLE IF NOT EXISTS "AssetKinds" (
    "Id" uuid PRIMARY KEY,
    "Code" text NOT NULL,
    "DisplayName" text NOT NULL,
    "Color" text NOT NULL,
    "DisplayOrder" integer NOT NULL,
    "ValueShape" text NOT NULL,
    "ArchivedAt" timestamptz NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "IX_AssetKinds_Code" ON "AssetKinds" ("Code");

CREATE TABLE IF NOT EXISTS "AssetKindGroups" (
    "AssetKindId" uuid NOT NULL,
    "AssetGroupId" uuid NOT NULL,
    CONSTRAINT "PK_AssetKindGroups" PRIMARY KEY ("AssetKindId", "AssetGroupId"),
    CONSTRAINT "FK_AssetKindGroups_AssetKinds" FOREIGN KEY ("AssetKindId") REFERENCES "AssetKinds" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_AssetKindGroups_AssetGroups" FOREIGN KEY ("AssetGroupId") REFERENCES "AssetGroups" ("Id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS "IX_AssetKindGroups_AssetKindId" ON "AssetKindGroups" ("AssetKindId");

CREATE TABLE IF NOT EXISTS "AssetKindAssignments" (
    "AssetId" uuid NOT NULL,
    "AssetKindId" uuid NOT NULL,
    CONSTRAINT "PK_AssetKindAssignments" PRIMARY KEY ("AssetId", "AssetKindId"),
    CONSTRAINT "FK_AssetKindAssignments_Assets" FOREIGN KEY ("AssetId") REFERENCES "Assets" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_AssetKindAssignments_AssetKinds" FOREIGN KEY ("AssetKindId") REFERENCES "AssetKinds" ("Id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS "IX_AssetKindAssignments_AssetId" ON "AssetKindAssignments" ("AssetId");

-- Rename the fact table before adding the new source bridge. The old type,
-- provider, and external-id columns are copied into relationships below and
-- then removed.
ALTER TABLE IF EXISTS "WealthEntries" RENAME TO "AssetValueEntries";
ALTER TABLE "AssetValueEntries" ADD COLUMN IF NOT EXISTS "AssetId" uuid;

-- Preserve the old property identity before filling any remaining null entry
-- asset IDs from display names. PropertyDefinition IDs are already domain
-- identities in the legacy model and must not be replaced by a name match.
INSERT INTO "Assets" ("Id", "DisplayName", "CreatedAt", "ArchivedAt")
SELECT p."Id", p."Name", p."CreatedAt", NULL
FROM "PropertyDefinitions" p
ON CONFLICT ("Id") DO NOTHING;

UPDATE "AssetValueEntries" e
SET "AssetId" = e."PropertyId"
WHERE e."AssetId" IS NULL
  AND e."PropertyId" IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM "Assets" a
      WHERE a."Id" = e."PropertyId"
  );

-- Ensure every old entry has a local Asset. Entries without an old asset ID
-- are matched to an existing display name or receive a new identity.
INSERT INTO "Assets" ("Id", "DisplayName", "CreatedAt", "ArchivedAt")
SELECT gen_random_uuid(), e."Name", now(), NULL
FROM "AssetValueEntries" e
WHERE e."AssetId" IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM "Assets" a
      WHERE lower(a."DisplayName") = lower(e."Name")
  );

UPDATE "AssetValueEntries" e
SET "AssetId" = a."Id"
FROM "Assets" a
WHERE e."AssetId" IS NULL
  AND lower(a."DisplayName") = lower(e."Name");

-- Backfill AssetKinds from the old asset-value classification group. The old
-- key is accepted in both legacy and already-renamed form.
INSERT INTO "AssetKinds" ("Id", "Code", "DisplayName", "Color", "DisplayOrder", "ValueShape", "ArchivedAt")
SELECT v."Id", v."Key", v."DisplayName", coalesce(v."Color", '#64748b'), v."DisplayOrder",
       CASE lower(v."Key")
           WHEN 'property' THEN 'Property'
           WHEN 'properties' THEN 'Property'
           WHEN 'investment' THEN 'Investment'
           WHEN 'investments' THEN 'Investment'
           WHEN 'pension' THEN 'Investment'
           WHEN 'pensions' THEN 'Investment'
           ELSE 'Cash'
       END,
       v."ArchivedAt"
FROM "ClassificationValues" v
JOIN "ClassificationGroups" g ON g."Id" = v."GroupId"
WHERE lower(g."Key") IN ('asset-class', 'asset-kind', 'asset-kinds')
ON CONFLICT DO NOTHING;

-- Backfill AssetGroups from the old liquidity/class grouping.
INSERT INTO "AssetGroups" ("Id", "Code", "DisplayName", "Color", "DisplayOrder", "IsSystem", "ArchivedAt")
SELECT v."Id", v."Key", v."DisplayName", coalesce(v."Color", '#64748b'), v."DisplayOrder", false, v."ArchivedAt"
FROM "ClassificationValues" v
JOIN "ClassificationGroups" g ON g."Id" = v."GroupId"
WHERE lower(g."Key") IN ('liquidity', 'asset-group', 'asset-groups')
ON CONFLICT DO NOTHING;

-- Seed the canonical defaults if the old catalogue did not contain them.
INSERT INTO "AssetGroups" ("Id", "Code", "DisplayName", "Color", "DisplayOrder", "IsSystem")
VALUES
    (gen_random_uuid(), 'liquid', 'Liquid', '#10b981', 1, true),
    (gen_random_uuid(), 'illiquid', 'Illiquid', '#f59e0b', 2, true)
ON CONFLICT ("Code") DO NOTHING;

INSERT INTO "AssetKinds" ("Id", "Code", "DisplayName", "Color", "DisplayOrder", "ValueShape")
VALUES
    (gen_random_uuid(), 'cash', 'Cash', '#06b6d4', 1, 'Cash'),
    (gen_random_uuid(), 'savings', 'Savings', '#3b82f6', 2, 'Cash'),
    (gen_random_uuid(), 'investments', 'Investments', '#10b981', 3, 'Investment'),
    (gen_random_uuid(), 'property', 'Property', '#f59e0b', 4, 'Property'),
    (gen_random_uuid(), 'pensions', 'Pensions', '#8b5cf6', 5, 'Investment'),
    (gen_random_uuid(), 'bonds', 'Bonds', '#ec4899', 6, 'Cash'),
    (gen_random_uuid(), 'unclassified', 'Unclassified', '#64748b', 99, 'Cash')
ON CONFLICT ("Code") DO NOTHING;

-- ParentValueId on an old asset value becomes the kind-to-group join.
INSERT INTO "AssetKindGroups" ("AssetKindId", "AssetGroupId")
SELECT k."Id", g2."Id"
FROM "ClassificationValues" child
JOIN "ClassificationGroups" child_group ON child_group."Id" = child."GroupId"
JOIN "ClassificationValues" parent ON parent."Id" = child."ParentValueId"
JOIN "ClassificationGroups" parent_group ON parent_group."Id" = parent."GroupId"
JOIN "AssetKinds" k ON lower(k."Code") = lower(child."Key")
JOIN "AssetGroups" g2 ON lower(g2."Code") = lower(parent."Key")
WHERE lower(child_group."Key") IN ('asset-class', 'asset-kind', 'asset-kinds')
  AND lower(parent_group."Key") IN ('liquidity', 'asset-group', 'asset-groups')
ON CONFLICT DO NOTHING;

-- Existing generic assignments become explicit kind assignments.
INSERT INTO "AssetKindAssignments" ("AssetId", "AssetKindId")
SELECT DISTINCT ac."AssetId", k."Id"
FROM "AssetClassifications" ac
JOIN "ClassificationValues" v ON v."Id" = ac."ClassificationValueId"
JOIN "ClassificationGroups" g ON g."Id" = v."GroupId"
JOIN "AssetKinds" k ON lower(k."Code") = lower(v."Key")
WHERE lower(g."Key") IN ('asset-class', 'asset-kind', 'asset-kinds')
ON CONFLICT DO NOTHING;

-- Entries that only had a text payload type still receive a kind. This is a
-- backfill fallback; the column itself is removed later.
INSERT INTO "AssetKindAssignments" ("AssetId", "AssetKindId")
SELECT DISTINCT e."AssetId", k."Id"
FROM "AssetValueEntries" e
JOIN "AssetKinds" k ON lower(k."Code") = CASE lower(coalesce(e."Type", ''))
    WHEN 'investment' THEN 'investments'
    ELSE lower(coalesce(e."Type", 'unclassified'))
END
WHERE e."AssetId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "AssetKindAssignments" ("AssetId", "AssetKindId")
SELECT a."Id", k."Id"
FROM "Assets" a
JOIN "AssetKinds" k ON k."Code" = 'unclassified'
WHERE NOT EXISTS (SELECT 1 FROM "AssetKindAssignments" x WHERE x."AssetId" = a."Id")
ON CONFLICT DO NOTHING;

-- Property identity is the Asset row; the old detail/name table is collapsed
-- into the one-to-one extension table.
CREATE TABLE IF NOT EXISTS "PropertyDetails" (
    "AssetId" uuid PRIMARY KEY,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "FK_PropertyDetails_Assets" FOREIGN KEY ("AssetId") REFERENCES "Assets" ("Id") ON DELETE CASCADE
);
INSERT INTO "PropertyDetails" ("AssetId", "CreatedAt")
SELECT p."Id", p."CreatedAt"
FROM "PropertyDefinitions" p
JOIN "Assets" a ON a."Id" = p."Id"
ON CONFLICT DO NOTHING;

-- Integration provider identity is separated from saved connections.
CREATE TABLE IF NOT EXISTS "IntegrationProviders" (
    "Id" uuid PRIMARY KEY,
    "Code" text NOT NULL,
    "DisplayName" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "IX_IntegrationProviders_Code" ON "IntegrationProviders" ("Code");

ALTER TABLE "IntegrationConnections" ADD COLUMN IF NOT EXISTS "IntegrationProviderId" uuid;
ALTER TABLE "IntegrationConnections" ADD COLUMN IF NOT EXISTS "Kind" integer NOT NULL DEFAULT 1;

INSERT INTO "IntegrationProviders" ("Id", "Code", "DisplayName")
SELECT gen_random_uuid(), c."ProviderKey", c."ProviderKey"
FROM "IntegrationConnections" c
WHERE c."ProviderKey" IS NOT NULL
ON CONFLICT ("Code") DO NOTHING;

UPDATE "IntegrationConnections" c
SET "IntegrationProviderId" = p."Id"
FROM "IntegrationProviders" p
WHERE lower(p."Code") = lower(c."ProviderKey");

ALTER TABLE "IntegrationConnections"
    ALTER COLUMN "IntegrationProviderId" SET NOT NULL;
ALTER TABLE "IntegrationConnections"
    ALTER COLUMN "Status" TYPE integer
    USING CASE lower("Status")
        WHEN 'needscredentials' THEN 1
        WHEN 'readytotest' THEN 2
        WHEN 'tested' THEN 3
        WHEN 'needsallocation' THEN 4
        WHEN 'active' THEN 5
        WHEN 'disabled' THEN 6
        WHEN 'error' THEN 7
        ELSE 1
    END;

UPDATE "IntegrationConnections" SET "Status" = 1 WHERE "Status" IS NULL;

CREATE TABLE IF NOT EXISTS "IntegrationAccountAssetMappings" (
    "IntegrationAccountId" uuid PRIMARY KEY,
    "AssetId" uuid NOT NULL,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "FK_IntegrationAccountAssetMappings_Accounts" FOREIGN KEY ("IntegrationAccountId") REFERENCES "IntegrationAccounts" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_IntegrationAccountAssetMappings_Assets" FOREIGN KEY ("AssetId") REFERENCES "Assets" ("Id") ON DELETE RESTRICT
);
INSERT INTO "IntegrationAccountAssetMappings" ("IntegrationAccountId", "AssetId")
SELECT a."Id", a."AssetId"
FROM "IntegrationAccounts" a
WHERE a."AssetId" IS NOT NULL
ON CONFLICT DO NOTHING;
ALTER TABLE "IntegrationAccounts" DROP COLUMN IF EXISTS "AssetId";

ALTER TABLE "IntegrationAccounts"
    ALTER COLUMN "Status" TYPE integer
    USING CASE lower("Status")
        WHEN 'allocated' THEN 2
        WHEN 'missing' THEN 3
        ELSE 1
    END;

-- External values are scoped to accounts. Legacy provider links are retained
-- by assigning them to the connection's first discovered account; if no
-- account existed, create one clearly marked as a migration placeholder.
INSERT INTO "IntegrationAccounts" (
    "Id", "IntegrationConnectionId", "ExternalId", "DisplayName", "AccountType", "Currency", "Status", "LastSeenAt", "CreatedAt"
)
SELECT gen_random_uuid(), c."Id", 'legacy-' || c."Id"::text, c."DisplayName", 'Investment', 'GBP', 2, now(), now()
FROM "IntegrationConnections" c
WHERE NOT EXISTS (
    SELECT 1 FROM "IntegrationAccounts" a WHERE a."IntegrationConnectionId" = c."Id"
);

CREATE TABLE IF NOT EXISTS "ExternalValues" (
    "Id" uuid PRIMARY KEY,
    "IntegrationAccountId" uuid NOT NULL,
    "ExternalId" text NOT NULL,
    "DisplayName" text NOT NULL,
    "Role" integer NOT NULL,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "LastSeenAt" timestamptz NULL,
    CONSTRAINT "FK_ExternalValues_Accounts" FOREIGN KEY ("IntegrationAccountId") REFERENCES "IntegrationAccounts" ("Id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "IX_ExternalValues_Account_ExternalId"
    ON "ExternalValues" ("IntegrationAccountId", "ExternalId");

CREATE TABLE IF NOT EXISTS "ExternalValueAssetMappings" (
    "ExternalValueId" uuid PRIMARY KEY,
    "AssetId" uuid NOT NULL,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "FK_ExternalValueAssetMappings_ExternalValues" FOREIGN KEY ("ExternalValueId") REFERENCES "ExternalValues" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_ExternalValueAssetMappings_Assets" FOREIGN KEY ("AssetId") REFERENCES "Assets" ("Id") ON DELETE RESTRICT
);

INSERT INTO "ExternalValues" ("Id", "IntegrationAccountId", "ExternalId", "DisplayName", "Role", "CreatedAt", "LastSeenAt")
SELECT l."Id",
       coalesce(
           (SELECT a."Id" FROM "IntegrationAccounts" a WHERE a."IntegrationConnectionId" = l."IntegrationConnectionId" ORDER BY a."CreatedAt" LIMIT 1),
           (SELECT a."Id" FROM "IntegrationAccounts" a ORDER BY a."CreatedAt" LIMIT 1)
       ),
       l."ExternalAssetId", l."ExternalName", 3, l."CreatedAt", l."LastSeenAt"
FROM "ProviderAssetLinks" l
WHERE coalesce(l."ExternalAssetId", '') <> ''
ON CONFLICT DO NOTHING;

INSERT INTO "ExternalValueAssetMappings" ("ExternalValueId", "AssetId", "CreatedAt")
SELECT e."Id", l."AssetId", l."CreatedAt"
FROM "ProviderAssetLinks" l
JOIN "ExternalValues" e ON e."Id" = l."Id"
ON CONFLICT DO NOTHING;

-- Source bridge and sync-run history.
CREATE TABLE IF NOT EXISTS "SyncRuns" (
    "Id" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    "IntegrationConnectionId" uuid NULL,
    "ConnectionDisplayNameSnapshot" text NOT NULL,
    "StartTime" timestamptz NOT NULL,
    "EndTime" timestamptz NULL,
    "Status" integer NOT NULL,
    "RecordsAdded" integer NOT NULL,
    "LogMessage" text NOT NULL
);
INSERT INTO "SyncRuns" ("Id", "IntegrationConnectionId", "ConnectionDisplayNameSnapshot", "StartTime", "EndTime", "Status", "RecordsAdded", "LogMessage")
SELECT a."Id", matched."Id", a."ProviderName", a."StartTime", a."EndTime",
       CASE lower(a."Status") WHEN 'success' THEN 2 WHEN 'failed' THEN 4 ELSE 3 END,
       a."RecordsAdded", a."LogMessage"
FROM "SyncAudits" a
LEFT JOIN LATERAL (
    SELECT candidate."Id"
    FROM "IntegrationConnections" candidate
    WHERE lower(candidate."DisplayName") = lower(a."ProviderName")
       OR lower(candidate."ProviderKey") = lower(a."ProviderName")
    ORDER BY CASE WHEN lower(candidate."DisplayName") = lower(a."ProviderName") THEN 0 ELSE 1 END,
             candidate."CreatedAt"
    LIMIT 1
) matched ON true
ON CONFLICT DO NOTHING;

-- Historical SyncRun IDs are copied explicitly above. Align the identity
-- sequence with the imported rows before any new sync attempts are written.
SELECT setval(
    pg_get_serial_sequence('"SyncRuns"', 'Id'),
    COALESCE(MAX("Id"), 1),
    MAX("Id") IS NOT NULL
)
FROM "SyncRuns";

CREATE TABLE IF NOT EXISTS "AssetValueEntrySources" (
    "AssetValueEntryId" integer PRIMARY KEY,
    "ExternalValueId" uuid NULL,
    "SyncRunId" integer NULL,
    "SourceKind" integer NOT NULL,
    CONSTRAINT "FK_AssetValueEntrySources_Entries" FOREIGN KEY ("AssetValueEntryId") REFERENCES "AssetValueEntries" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_AssetValueEntrySources_ExternalValues" FOREIGN KEY ("ExternalValueId") REFERENCES "ExternalValues" ("Id") ON DELETE SET NULL,
    CONSTRAINT "FK_AssetValueEntrySources_SyncRuns" FOREIGN KEY ("SyncRunId") REFERENCES "SyncRuns" ("Id") ON DELETE SET NULL
);

-- Integration rows with a matching old provider/external pair receive an
-- integration source; every other entry is explicitly marked manual.
INSERT INTO "AssetValueEntrySources" ("AssetValueEntryId", "ExternalValueId", "SourceKind")
SELECT e."Id", x."Id", 2
FROM "AssetValueEntries" e
JOIN "IntegrationConnections" c ON lower(c."ProviderKey") = lower(e."ProviderKey")
JOIN "IntegrationAccounts" ia ON ia."IntegrationConnectionId" = c."Id"
JOIN "ExternalValues" x ON x."IntegrationAccountId" = ia."Id" AND x."ExternalId" = e."ExternalAssetId"
ON CONFLICT DO NOTHING;
INSERT INTO "AssetValueEntrySources" ("AssetValueEntryId", "SourceKind")
SELECT e."Id", 1
FROM "AssetValueEntries" e
WHERE NOT EXISTS (SELECT 1 FROM "AssetValueEntrySources" s WHERE s."AssetValueEntryId" = e."Id")
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "BudgetLines" (
    "Id" uuid PRIMARY KEY,
    "Category" integer NOT NULL,
    "Name" text NOT NULL,
    "Amount" numeric(18,2) NOT NULL,
    "Cadence" integer NOT NULL
);
CREATE TABLE IF NOT EXISTS "BudgetLineAssetMappings" (
    "BudgetLineId" uuid NOT NULL,
    "AssetId" uuid NOT NULL,
    CONSTRAINT "PK_BudgetLineAssetMappings" PRIMARY KEY ("BudgetLineId", "AssetId"),
    CONSTRAINT "FK_BudgetLineAssetMappings_BudgetLines" FOREIGN KEY ("BudgetLineId") REFERENCES "BudgetLines" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_BudgetLineAssetMappings_Assets" FOREIGN KEY ("AssetId") REFERENCES "Assets" ("Id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS "IX_BudgetLineAssetMappings_BudgetLineId"
    ON "BudgetLineAssetMappings" ("BudgetLineId");

-- Preserve the legacy JSON budget document while the old Settings table is
-- still available. Budget rows are now relational, so the application can
-- safely return and update them without keeping a second JSON copy.
CREATE TEMP TABLE "_LegacyBudgetItems" ON COMMIT DROP AS
WITH budget_document AS (
    SELECT COALESCE(
        (SELECT "Value"::jsonb
         FROM "Settings"
         WHERE "Key" = 'wealthWatcherBudgetSettings'
         LIMIT 1),
        '{}'::jsonb) AS "Document"
), budget_items AS (
    SELECT 1 AS "Category", item
    FROM budget_document,
         LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof("Document"->'income') = 'array'
                  THEN "Document"->'income' ELSE '[]'::jsonb END) AS income(item)
    UNION ALL
    SELECT 2 AS "Category", item
    FROM budget_document,
         LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof("Document"->'bills') = 'array'
                  THEN "Document"->'bills' ELSE '[]'::jsonb END) AS bills(item)
    UNION ALL
    SELECT 3 AS "Category", item
    FROM budget_document,
         LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof("Document"->'savings') = 'array'
                  THEN "Document"->'savings' ELSE '[]'::jsonb END) AS savings(item)
    UNION ALL
    SELECT 4 AS "Category", item
    FROM budget_document,
         LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof("Document"->'spend') = 'array'
                  THEN "Document"->'spend' ELSE '[]'::jsonb END) AS spend(item)
)
SELECT
    gen_random_uuid() AS "Id",
    "Category",
    trim(item->>'name') AS "Name",
    COALESCE(NULLIF(trim(item->>'amount'), ''), '0')::numeric(18,2) AS "Amount",
    CASE lower(coalesce(item->>'cadence', 'monthly'))
        WHEN 'quarterly' THEN 2
        WHEN 'annually' THEN 3
        WHEN 'annual' THEN 3
        WHEN 'yearly' THEN 3
        ELSE 1
    END AS "Cadence",
    NULLIF(trim(item->>'assetId'), '') AS "AssetIdText"
FROM budget_items
WHERE jsonb_typeof(item) = 'object'
  AND nullif(trim(item->>'name'), '') IS NOT NULL;

INSERT INTO "BudgetLines" ("Id", "Category", "Name", "Amount", "Cadence")
SELECT "Id", "Category", "Name", "Amount", "Cadence"
FROM "_LegacyBudgetItems"
WHERE NOT EXISTS (SELECT 1 FROM "BudgetLines");

INSERT INTO "BudgetLineAssetMappings" ("BudgetLineId", "AssetId")
SELECT item."Id", asset."Id"
FROM "_LegacyBudgetItems" item
JOIN "Assets" asset
  ON asset."Id" = CASE
      WHEN item."AssetIdText" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN item."AssetIdText"::uuid
      ELSE NULL
  END
WHERE item."Category" = 3
  AND NOT EXISTS (
      SELECT 1
      FROM "BudgetLineAssetMappings" mapping
      WHERE mapping."BudgetLineId" = item."Id");

-- Preferences retain the four flexible UI documents; budget asset references
-- are deliberately moved out of JSON by the application on first save.
CREATE TABLE IF NOT EXISTS "AppPreferences" (
    "Id" integer PRIMARY KEY,
    "GeneralJson" text NOT NULL,
    "FeatureJson" text NOT NULL,
    "ForecastJson" text NOT NULL,
    "FireJson" text NOT NULL
);
INSERT INTO "AppPreferences" ("Id", "GeneralJson", "FeatureJson", "ForecastJson", "FireJson")
VALUES (
    1,
    coalesce((SELECT "Value" FROM "Settings" WHERE "Key" = 'wealthWatcherGeneralSettings'), '{}'),
    coalesce((SELECT "Value" FROM "Settings" WHERE "Key" = 'wealthWatcherFeatureSettings'), '{}'),
    coalesce((SELECT "Value" FROM "Settings" WHERE "Key" = 'wealthWatcherForecastSettings'), '{}'),
    coalesce((SELECT "Value" FROM "Settings" WHERE "Key" = 'wealthWatcherFireSettings'), '{}')
)
ON CONFLICT ("Id") DO NOTHING;

-- Remove columns and legacy tables only after all relationships have been
-- copied. The new model intentionally has no LegacyKey, EntryKind, Type,
-- ProviderKey, ExternalAssetId, PropertyId, CashHandling, or CashAssetId.
ALTER TABLE "Assets" DROP COLUMN IF EXISTS "LegacyKey";
ALTER TABLE "Assets" DROP COLUMN IF EXISTS "EntryKind";
ALTER TABLE "AssetValueEntries" DROP COLUMN IF EXISTS "Type";
ALTER TABLE "AssetValueEntries" DROP COLUMN IF EXISTS "ProviderKey";
ALTER TABLE "AssetValueEntries" DROP COLUMN IF EXISTS "ExternalAssetId";
ALTER TABLE "AssetValueEntries" DROP COLUMN IF EXISTS "Source";
ALTER TABLE "AssetValueEntries" DROP COLUMN IF EXISTS "PropertyId";
ALTER TABLE "IntegrationAccounts" DROP COLUMN IF EXISTS "CashHandling";
ALTER TABLE "IntegrationAccounts" DROP COLUMN IF EXISTS "CashAssetId";
ALTER TABLE "IntegrationConnections" DROP COLUMN IF EXISTS "ProviderKey";
ALTER TABLE "AssetValueEntries" ALTER COLUMN "AssetId" SET NOT NULL;

DROP TABLE IF EXISTS "ProviderAssetLinks";
DROP TABLE IF EXISTS "AssetClassifications";
DROP TABLE IF EXISTS "ClassificationValues";
DROP TABLE IF EXISTS "ClassificationGroups";
DROP TABLE IF EXISTS "PropertyDefinitions";
DROP TABLE IF EXISTS "SyncAudits";
DROP TABLE IF EXISTS "Settings";

-- Mark the bridge as applied so the application startup Migrate() call does
-- not attempt to recreate the target tables after this one-time backfill.
CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL,
    CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId")
);
INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
SELECT '20260805190958_SchemaRefactor', '10.0.9'
WHERE NOT EXISTS (
    SELECT 1 FROM "__EFMigrationsHistory"
    WHERE "MigrationId" = '20260805190958_SchemaRefactor'
);

COMMIT;
