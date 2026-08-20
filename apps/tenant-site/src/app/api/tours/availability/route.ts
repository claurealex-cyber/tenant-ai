import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveTenantContext } from "@/lib/tenant-context";
import { computeAvailableSlots } from "@tenant-ai/shared";

/**
 * GET /api/tours/availability?propertyId=X&startDate=Y&endDate=Z
 *
 * Public endpoint — returns available tour time slots for a property
 * within the given date range.
 */
export async function GET(request: NextRequest) {
  try {
    const hostname =
      request.headers.get("x-tenant-host") ||
      request.headers.get("host") ||
      "";

    const ctx = await resolveTenantContext(hostname);
    if (!ctx) {
      return NextResponse.json({ error: "Website not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (!propertyId || !startDate || !endDate) {
      return NextResponse.json(
        { error: "propertyId, startDate, and endDate are required" },
        { status: 400 }
      );
    }

    // Validate date format
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json(
        { error: "Invalid date format" },
        { status: 400 }
      );
    }

    // Verify property belongs to this landlord and is active
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
    });

    if (!property || property.userId !== ctx.userId || !property.isActive) {
      return NextResponse.json(
        { error: "Property not found" },
        { status: 404 }
      );
    }

    // Fetch active tour slot configurations for this property
    const tourSlots = await prisma.tourSlot.findMany({
      where: {
        propertyId,
        isActive: true,
      },
    });

    // Fetch existing non-canceled bookings in the date range
    const existingBookings = await prisma.tourBooking.findMany({
      where: {
        propertyId,
        status: { not: "canceled" },
        date: {
          gte: start,
          lte: new Date(end.getTime() + 24 * 60 * 60 * 1000), // include full end day
        },
      },
      select: {
        date: true,
        status: true,
      },
    });

    // Compute available slots using shared utility
    const slots = computeAvailableSlots(tourSlots, existingBookings, {
      start,
      end,
    });

    return NextResponse.json({ slots });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
