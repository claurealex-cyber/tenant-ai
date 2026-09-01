CREATE TABLE "ExplorerListing" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "address" TEXT NOT NULL,
  "unit" TEXT,
  "zip" TEXT,
  "neighborhood" TEXT,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "price" INTEGER,
  "beds" INTEGER,
  "baths" DOUBLE PRECISION,
  "sqft" INTEGER,
  "propertyType" TEXT NOT NULL,
  "typeSource" TEXT,
  "mlsNumber" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "verifiedAt" TIMESTAMP(3),
  "listedDate" TIMESTAMP(3),
  "daysOnMarket" INTEGER,
  "hoa" INTEGER,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "priceHistory" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExplorerListing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExplorerListing_listingId_key" ON "ExplorerListing"("listingId");
CREATE INDEX "ExplorerListing_status_idx" ON "ExplorerListing"("status");
CREATE INDEX "ExplorerListing_propertyType_idx" ON "ExplorerListing"("propertyType");
CREATE INDEX "ExplorerListing_neighborhood_idx" ON "ExplorerListing"("neighborhood");
CREATE INDEX "ExplorerListing_price_idx" ON "ExplorerListing"("price");
