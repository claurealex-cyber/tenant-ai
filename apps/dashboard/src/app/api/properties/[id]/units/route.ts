import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/properties/[id]/units — list units for a property.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const property = await prisma.property.findFirst({
    where: { id: params.id, userId: session.user.id },
  });

  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const units = await prisma.unit.findMany({
    where: { propertyId: params.id },
    orderBy: { unitNumber: "asc" },
  });

  return NextResponse.json({ units });
}

/**
 * POST /api/properties/[id]/units — create a unit.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const property = await prisma.property.findFirst({
      where: { id: params.id, userId: session.user.id },
    });

    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const {
      unitNumber,
      bedrooms,
      bathrooms,
      sqft,
      monthlyRent,
      description,
      petPolicy,
      parkingInfo,
      utilitiesIncluded,
      laundry,
      availableDate,
    } = await request.json();

    if (!unitNumber) {
      return NextResponse.json(
        { error: "Unit number is required" },
        { status: 400 }
      );
    }

    if (!monthlyRent || monthlyRent <= 0) {
      return NextResponse.json(
        { error: "Monthly rent must be greater than 0" },
        { status: 400 }
      );
    }

    // Check for duplicate unit number within this property
    const existing = await prisma.unit.findUnique({
      where: {
        propertyId_unitNumber: {
          propertyId: params.id,
          unitNumber: String(unitNumber),
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Unit "${unitNumber}" already exists for this property` },
        { status: 400 }
      );
    }

    const unit = await prisma.unit.create({
      data: {
        propertyId: params.id,
        unitNumber: String(unitNumber),
        bedrooms: bedrooms ?? null,
        bathrooms: bathrooms ?? null,
        sqft: sqft ?? null,
        monthlyRent,
        status: "vacant",
        description: description ?? null,
        petPolicy: petPolicy ?? null,
        parkingInfo: parkingInfo ?? null,
        utilitiesIncluded: utilitiesIncluded ?? null,
        laundry: laundry ?? null,
        availableDate: availableDate ? new Date(availableDate) : null,
      },
    });

    return NextResponse.json({ unit }, { status: 201 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
