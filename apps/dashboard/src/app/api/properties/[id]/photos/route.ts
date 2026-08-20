import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/properties/[id]/photos — list photos for a property.
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

  const photos = await prisma.propertyPhoto.findMany({
    where: { propertyId: params.id },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ photos });
}

/**
 * POST /api/properties/[id]/photos — add a photo record.
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

    // Check max 20 photos
    const count = await prisma.propertyPhoto.count({
      where: { propertyId: params.id },
    });

    if (count >= 20) {
      return NextResponse.json(
        { error: "Maximum 20 photos per property" },
        { status: 400 }
      );
    }

    const { url, caption } = await request.json();

    if (!url) {
      return NextResponse.json(
        { error: "Photo URL is required" },
        { status: 400 }
      );
    }

    const photo = await prisma.propertyPhoto.create({
      data: {
        propertyId: params.id,
        url,
        caption: caption || null,
        sortOrder: count,
      },
    });

    return NextResponse.json({ photo }, { status: 201 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PUT /api/properties/[id]/photos — reorder photos.
 */
export async function PUT(
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

    const { order } = await request.json();

    if (!Array.isArray(order)) {
      return NextResponse.json(
        { error: "order must be an array of { id, sortOrder }" },
        { status: 400 }
      );
    }

    // Verify all photo IDs belong to this property
    const existingPhotos = await prisma.propertyPhoto.findMany({
      where: { propertyId: params.id },
      select: { id: true },
    });
    const validIds = new Set(existingPhotos.map((p) => p.id));
    const allValid = order.every(
      (item: { id: string }) => validIds.has(item.id)
    );

    if (!allValid) {
      return NextResponse.json(
        { error: "One or more photo IDs do not belong to this property" },
        { status: 403 }
      );
    }

    // Update sort orders in a transaction
    await prisma.$transaction(
      order.map((item: { id: string; sortOrder: number }) =>
        prisma.propertyPhoto.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        })
      )
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
