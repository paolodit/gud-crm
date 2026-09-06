-- Archive columns/index were already added by 0009_archive_records.
-- Nullable delivery leaves every existing sales record unchanged.
ALTER TABLE "opportunities" ADD COLUMN "delivery" jsonb;
