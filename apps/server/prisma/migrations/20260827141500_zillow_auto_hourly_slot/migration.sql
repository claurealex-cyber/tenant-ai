-- Hourly Zillow auto-runs: replace the per-day idempotence key with a per-hour slot.
DROP INDEX IF EXISTS "ZillowAutoRun_day_key";
ALTER TABLE "ZillowAutoRun" ADD COLUMN IF NOT EXISTS "slot" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ZillowAutoRun_slot_key" ON "ZillowAutoRun"("slot");
