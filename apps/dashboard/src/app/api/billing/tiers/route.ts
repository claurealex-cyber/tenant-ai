import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/tiers — list all active pricing tiers (public).
 */
export async function GET() {
  const tiers = await prisma.pricingTier.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      displayName: true,
      basePriceCents: true,
      includedAiCents: true,
      aiMarkupPercent: true,
      maxProperties: true,
      maxPhoneNumbers: true,
      websiteEnabled: true,
      customDomainEnabled: true,
      description: true,
      sortOrder: true,
    },
  });

  return NextResponse.json({ tiers });
}
