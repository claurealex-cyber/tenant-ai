import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveTenantContext } from "@/lib/tenant-context";

/**
 * GET /api/properties/[id] — property detail.
 *
 * Public endpoint — no auth required.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const hostname = request.headers.get("x-tenant-host") || request.headers.get("host") || "";

  const ctx = await resolveTenantContext(hostname);
  if (!ctx) {
    return NextResponse.json({ error: "Website not found" }, { status: 404 });
  }

  const { id } = await params;

  const property = await prisma.property.findUnique({
    where: { id },
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
          description: true,
          petPolicy: true,
          parkingInfo: true,
          utilitiesIncluded: true,
          laundry: true,
          availableDate: true,
        },
        orderBy: { unitNumber: "asc" },
      },
      photos: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, url: true, caption: true },
      },
      questions: {
        where: { required: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, text: true, fieldKey: true, type: true, required: true },
      },
      tourSlots: {
        where: { isActive: true },
        select: { id: true },
      },
    },
  });

  if (!property || property.userId !== ctx.userId || !property.isActive) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  return NextResponse.json({
    property: {
      id: property.id,
      name: property.name,
      address: property.address,
      description: property.description,
      amenities: property.amenities,
      petPolicy: property.petPolicy,
      twilioPhone: property.twilioPhone,
      units: property.units,
      photos: property.photos,
      questions: property.questions,
      hasTourSlots: property.tourSlots.length > 0,
    },
  });
}
