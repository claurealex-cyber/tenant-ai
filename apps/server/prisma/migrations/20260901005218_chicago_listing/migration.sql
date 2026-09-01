CREATE TABLE "ChicagoListing" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "canonicalUrl" TEXT,
  "address" TEXT NOT NULL,
  "unit" TEXT,
  "zip" TEXT,
  "neighborhood" TEXT,
  "communityArea" TEXT,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "price" INTEGER,
  "beds" INTEGER,
  "baths" DOUBLE PRECISION,
  "sqft" INTEGER,
  "propertyType" TEXT,
  "mlsNumber" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "verifiedAt" TIMESTAMP(3),
  "listedDate" TIMESTAMP(3),
  "daysOnMarket" INTEGER,
  "hoa" INTEGER,
  "remarks" TEXT,
  "qualityFlags" TEXT[],
  "isQuality" BOOLEAN NOT NULL DEFAULT true,
  "priceHistory" JSONB,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChicagoListing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChicagoListing_listingId_key" ON "ChicagoListing"("listingId");
CREATE INDEX "ChicagoListing_status_idx" ON "ChicagoListing"("status");
CREATE INDEX "ChicagoListing_neighborhood_idx" ON "ChicagoListing"("neighborhood");
CREATE INDEX "ChicagoListing_price_idx" ON "ChicagoListing"("price");
