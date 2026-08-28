CREATE TABLE IF NOT EXISTS "TextEmAllFire" (
  "id" TEXT PRIMARY KEY,
  "month" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "ref" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "TextEmAllFire_month_idx" ON "TextEmAllFire"("month");
