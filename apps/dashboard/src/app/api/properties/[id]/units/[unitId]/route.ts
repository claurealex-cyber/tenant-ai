import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/properties/[id]/units/[unitId] — get a single unit.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; unitId: string } }
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

  const unit = await prisma.unit.findFirst({
    where: { id: params.unitId, propertyId: params.id },
  });

  if (!unit) {
    return NextResponse.json({ error: "Unit not found" }, { status: 404 });
  }

  return NextResponse.json({ unit });
}

/**
 * PUT /api/properties/[id]/units/[unitId] — update a unit.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; unitId: string } }
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

  const unit = await prisma.unit.findFirst({
    where: { id: params.unitId, propertyId: params.id },
  });

  if (!unit) {
    return NextResponse.json({ error: "Unit not found" }, { status: 404 });
  }

  const {
    unitNumber,
    bedrooms,
    bathrooms,
    sqft,
    monthlyRent,
    status,
    description,
    petPolicy,
    parkingInfo,
    utilitiesIncluded,
    laundry,
    availableDate,
  } = await request.json();

  // Validate monthlyRent if provided
  if (monthlyRent !== undefined && monthlyRent <= 0) {
    return NextResponse.json(
      { error: "Monthly rent must be greater than 0" },
      { status: 400 }
    );
  }

  // Check for duplicate unit number if changing it
  if (unitNumber !== undefined && String(unitNumber) !== unit.unitNumber) {
    const duplicate = await prisma.unit.findUnique({
      where: {
        propertyId_unitNumber: {
          propertyId: params.id,
          unitNumber: String(unitNumber),
        },
      },
    });

    if (duplicate) {
      return NextResponse.json(
        { error: `Unit "${unitNumber}" already exists for this property` },
        { status: 400 }
      );
    }
  }

  // Validate status if provided
  const validStatuses = ["vacant", "occupied", "maintenance"];
  if (status !== undefined && !validStatuses.includes(status)) {
    return NextResponse.json(
      { error: `Status must be one of: ${validStatuses.join(", ")}` },
      { status: 400 }
    );
  }

  const updated = await prisma.unit.update({
    where: { id: params.unitId },
    data: {
      ...(unitNumber !== undefined && { unitNumber: String(unitNumber) }),
      ...(bedrooms !== undefined && { bedrooms }),
      ...(bathrooms !== undefined && { bathrooms }),
      ...(sqft !== undefined && { sqft }),
      ...(monthlyRent !== undefined && { monthlyRent }),
      ...(status !== undefined && { status }),
      ...(description !== undefined && { description }),
      ...(petPolicy !== undefined && { petPolicy }),
      ...(parkingInfo !== undefined && { parkingInfo }),
      ...(utilitiesIncluded !== undefined && { utilitiesIncluded }),
      ...(laundry !== undefined && { laundry }),
      ...(availableDate !== undefined && {
        availableDate: availableDate ? new Date(availableDate) : null,
      }),
    },
  });

  return NextResponse.json({ unit: updated });
}

/**
 * DELETE /api/properties/[id]/units/[unitId] — delete a unit.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; unitId: string } }
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

  const unit = await prisma.unit.findFirst({
    where: { id: params.unitId, propertyId: params.id },
    include: {
      leases: { where: { status: "active" } },
    },
  });

  if (!unit) {
    return NextResponse.json({ error: "Unit not found" }, { status: 404 });
  }

  if (unit.leases.length > 0) {
    return NextResponse.json(
      { error: "Cannot delete unit with active leases" },
      { status: 400 }
    );
  }

  await prisma.unit.delete({ where: { id: params.unitId } });

  return NextResponse.json({ success: true });
}
