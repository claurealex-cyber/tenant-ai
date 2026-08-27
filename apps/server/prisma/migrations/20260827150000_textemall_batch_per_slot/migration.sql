DROP INDEX IF EXISTS "TextEmAllBatch_day_key";
ALTER TABLE "TextEmAllBatch" ADD COLUMN IF NOT EXISTS "slot" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "TextEmAllBatch_slot_key" ON "TextEmAllBatch"("slot");
