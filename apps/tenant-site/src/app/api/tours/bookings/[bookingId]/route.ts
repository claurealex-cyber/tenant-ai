import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveTenantContext } from "@/lib/tenant-context";
import { sendEmail, textToHtml } from "@tenant-ai/shared";

/**
 * PUT /api/tours/bookings/[bookingId] — cancel a tour booking.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> }
) {
  try {
    const hostname =
      request.headers.get("x-tenant-host") ||
      request.headers.get("host") ||
      "";

    const ctx = await resolveTenantContext(hostname);
    if (!ctx) {
      return NextResponse.json({ error: "Website not found" }, { status: 404 });
    }

    const { bookingId } = await params;
    const body = await request.json();
    const { status, email, phone } = body;

    if (status !== "canceled") {
      return NextResponse.json(
        { error: "Only cancellation is supported" },
        { status: 400 }
      );
    }

    // Fetch booking and verify ownership
    const booking = await prisma.tourBooking.findUnique({
      where: { id: bookingId },
      include: {
        property: {
          select: { id: true, name: true, address: true, userId: true },
        },
      },
    });

    if (!booking || booking.property.userId !== ctx.userId) {
      return NextResponse.json(
        { error: "Booking not found" },
        { status: 404 }
      );
    }

    if (booking.status === "canceled") {
      return NextResponse.json(
        { error: "Booking is already canceled" },
        { status: 400 }
      );
    }

    // Verify identity: either booking email/phone matches or provided email/phone matches
    const verifiedByEmail = email && booking.email && email.toLowerCase() === booking.email.toLowerCase();
    const verifiedByPhone = phone && booking.phone && phone === booking.phone;
    if (!verifiedByEmail && !verifiedByPhone) {
      return NextResponse.json(
        { error: "Could not verify your identity. Please provide the email or phone used when booking." },
        { status: 403 }
      );
    }

    // Cancel the booking
    const updated = await prisma.tourBooking.update({
      where: { id: bookingId },
      data: { status: "canceled" },
    });

    // Notify landlord (best-effort)
    try {
      const landlord = await prisma.user.findUnique({
        where: { id: booking.property.userId },
        select: { email: true },
      });

      if (landlord) {
        const tourDate = booking.date.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        const tourTime = booking.date.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });

        const emailBody = [
          `A tour has been canceled for ${booking.property.name}.`,
          "",
          `Name: ${booking.name}`,
          `Original Date: ${tourDate} at ${tourTime}`,
          "",
          "The time slot is now available for other bookings.",
        ].join("\n");

        const emailSubject = `Tour Canceled - ${booking.property.name}`;
        await sendEmail({
          to: landlord.email,
          subject: emailSubject,
          html: textToHtml(emailBody, emailSubject),
        });
      }
    } catch {
      // Don't fail if notification fails
    }

    return NextResponse.json({
      booking: {
        id: updated.id,
        status: updated.status,
      },
    });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
