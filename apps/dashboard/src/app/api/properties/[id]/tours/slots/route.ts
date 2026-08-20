import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/properties/[id]/tours/slots — list tour slots for a property.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const property = await prisma.property.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const slots = await prisma.tourSlot.findMany({
    where: { propertyId: id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ slots });
}

/**
 * POST /api/properties/[id]/tours/slots — create a tour slot.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const property = await prisma.property.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const { dayOfWeek, specificDate, startTime, endTime, slotMinutes } =
      await request.json();

    // Validate: must have either dayOfWeek or specificDate, not both
    if (dayOfWeek === undefined && !specificDate) {
      return NextResponse.json(
        { error: "Either dayOfWeek or specificDate is required" },
        { status: 400 }
      );
    }

    if (dayOfWeek !== undefined && specificDate) {
      return NextResponse.json(
        { error: "Provide either dayOfWeek or specificDate, not both" },
        { status: 400 }
      );
    }

    if (dayOfWeek !== undefined && (dayOfWeek < 0 || dayOfWeek > 6)) {
      return NextResponse.json(
        { error: "dayOfWeek must be 0 (Sunday) through 6 (Saturday)" },
        { status: 400 }
      );
    }

    if (!startTime || !endTime) {
      return NextResponse.json(
        { error: "startTime and endTime are required" },
        { status: 400 }
      );
    }

    // Validate time format HH:mm
    const timeRegex = /^\d{2}:\d{2}$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      return NextResponse.json(
        { error: "Times must be in HH:mm format" },
        { status: 400 }
      );
    }

    if (startTime >= endTime) {
      return NextResponse.json(
        { error: "Start time must be before end time" },
        { status: 400 }
      );
    }

    const duration = slotMinutes || 30;
    if (duration < 10 || duration > 240) {
      return NextResponse.json(
        { error: "Slot duration must be between 10 and 240 minutes" },
        { status: 400 }
      );
    }

    const slot = await prisma.tourSlot.create({
      data: {
        propertyId: id,
        dayOfWeek: dayOfWeek !== undefined ? dayOfWeek : null,
        specificDate: specificDate ? new Date(specificDate) : null,
        startTime,
        endTime,
        slotMinutes: duration,
      },
    });

    return NextResponse.json({ slot }, { status: 201 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
