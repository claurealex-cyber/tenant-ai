import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * PUT /api/properties/[id]/tours/slots/[slotId] — update a tour slot.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; slotId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, slotId } = await params;

    const property = await prisma.property.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const slot = await prisma.tourSlot.findFirst({
      where: { id: slotId, propertyId: id },
    });

    if (!slot) {
      return NextResponse.json({ error: "Tour slot not found" }, { status: 404 });
    }

    const { isActive, dayOfWeek, specificDate, startTime, endTime, slotMinutes } =
      await request.json();

    // Validate time format if provided
    const timeRegex = /^\d{2}:\d{2}$/;
    if (startTime !== undefined && !timeRegex.test(startTime)) {
      return NextResponse.json(
        { error: "startTime must be in HH:mm format" },
        { status: 400 }
      );
    }
    if (endTime !== undefined && !timeRegex.test(endTime)) {
      return NextResponse.json(
        { error: "endTime must be in HH:mm format" },
        { status: 400 }
      );
    }

    const newStart = startTime ?? slot.startTime;
    const newEnd = endTime ?? slot.endTime;
    if (newStart >= newEnd) {
      return NextResponse.json(
        { error: "Start time must be before end time" },
        { status: 400 }
      );
    }

    if (slotMinutes !== undefined && (slotMinutes < 10 || slotMinutes > 240)) {
      return NextResponse.json(
        { error: "Slot duration must be between 10 and 240 minutes" },
        { status: 400 }
      );
    }

    const updated = await prisma.tourSlot.update({
      where: { id: slotId },
      data: {
        ...(isActive !== undefined && { isActive }),
        ...(dayOfWeek !== undefined && { dayOfWeek }),
        ...(specificDate !== undefined && {
          specificDate: specificDate ? new Date(specificDate) : null,
        }),
        ...(startTime !== undefined && { startTime }),
        ...(endTime !== undefined && { endTime }),
        ...(slotMinutes !== undefined && { slotMinutes }),
      },
    });

    return NextResponse.json({ slot: updated });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/properties/[id]/tours/slots/[slotId] — delete a tour slot.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; slotId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, slotId } = await params;

    const property = await prisma.property.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const slot = await prisma.tourSlot.findFirst({
      where: { id: slotId, propertyId: id },
    });

    if (!slot) {
      return NextResponse.json({ error: "Tour slot not found" }, { status: 404 });
    }

    await prisma.tourSlot.delete({ where: { id: slotId } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
