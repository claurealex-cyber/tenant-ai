-- Home Search (buyer) module: saved searches + the listing dataset
CREATE TABLE "BuyerSearch" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "alertsArmed" BOOLEAN NOT NULL DEFAULT false,
  "notifyPhone" TEXT NOT NULL,
  "priceMax" INTEGER,
  "priceMin" INTEGER,
  "beds" INTEGER,
  "baths" DOUBLE PRECISION,
  "propertyType" TEXT,
  "zips" TEXT[],
  "centerLat" DOUBLE PRECISION,
  "centerLng" DOUBLE PRECISION,
  "radiusMi" DOUBLE PRECISION,
  "keywords" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'search',
  "lastRunAt" TIMESTAMP(3),
  "lastRunCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BuyerSearch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BuyerSearch_enabled_idx" ON "BuyerSearch"("enabled");

CREATE TABLE "BuyerListing" (
  "id" TEXT NOT NULL,
  "searchId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "canonicalUrl" TEXT,
  "address" TEXT NOT NULL,
  "unit" TEXT,
  "zip" TEXT,
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
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "priceHistory" JSONB,
  "areaTag" TEXT,
  "notified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BuyerListing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BuyerListing_searchId_listingId_key" ON "BuyerListing"("searchId","listingId");
CREATE INDEX "BuyerListing_searchId_idx" ON "BuyerListing"("searchId");
CREATE INDEX "BuyerListing_status_idx" ON "BuyerListing"("status");
ALTER TABLE "BuyerListing" ADD CONSTRAINT "BuyerListing_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "BuyerSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
