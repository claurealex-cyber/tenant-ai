import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveTenantContext } from "@/lib/tenant-context";

/**
 * GET /api/properties — list properties for the resolved landlord.
 *
 * Public endpoint — no auth required.
 */
export async function GET(request: NextRequest) {
  const hostname = request.headers.get("x-tenant-host") || request.headers.get("host") || "";

  const ctx = await resolveTenantContext(hostname);
  if (!ctx) {
    return NextResponse.json({ error: "Website not found" }, { status: 404 });
  }

  const properties = await prisma.property.findMany({
    where: {
      userId: ctx.userId,
      isActive: true,
    },
    include: {
      units: {
        where: { status: "vacant" },
        select: {
          id: true,
          unitNumber: true,
          bedrooms: true,
          bathrooms: true,
          sqft: true,
          monthlyRent: true,
        },
      },
      photos: {
        orderBy: { sortOrder: "asc" },
        take: 1,
        select: { url: true, caption: true },
      },
      tourSlots: {
        where: { isActive: true },
        select: { id: true },
      },
    },
    orderBy: { name: "asc" },
  });

  // Calculate rent range per property
  const result = properties.map((p) => {
    const rents = p.units.map((u) => u.monthlyRent);
    return {
      id: p.id,
      name: p.name,
      address: p.address,
      description: p.description,
      amenities: p.amenities,
      availableUnits: p.units.length,
      rentMin: rents.length > 0 ? Math.min(...rents) : null,
      rentMax: rents.length > 0 ? Math.max(...rents) : null,
      photo: p.photos[0]?.url ?? null,
      hasTourSlots: (p.tourSlots?.length ?? 0) > 0,
    };
  });

  return NextResponse.json({
    properties: result,
    branding: {
      companyName: ctx.companyName,
      logoUrl: ctx.logoUrl,
      primaryColor: ctx.primaryColor,
      heroImageUrl: ctx.heroImageUrl,
      aboutText: ctx.aboutText,
      contactEmail: ctx.contactEmail,
      contactPhone: ctx.contactPhone,
    },
  });
}
