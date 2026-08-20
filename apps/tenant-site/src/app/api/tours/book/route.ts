import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveTenantContext } from "@/lib/tenant-context";
import { sendEmail, textToHtml } from "@tenant-ai/shared";

/**
 * POST /api/tours/book — book a tour for a property.
 *
 * Public endpoint — no auth required.
 *
 * Body: { propertyId, name, email?, phone?, datetime, notes? }
 */
export async function POST(request: NextRequest) {
  try {
    const hostname =
      request.headers.get("x-tenant-host") ||
      request.headers.get("host") ||
      "";

    const ctx = await resolveTenantContext(hostname);
    if (!ctx) {
      return NextResponse.json({ error: "Website not found" }, { status: 404 });
    }

    const body = await request.json();
    const { propertyId, name, email, phone, datetime, notes } = body;

    // Validate required fields
    if (!propertyId) {
      return NextResponse.json(
        { error: "propertyId is required" },
        { status: 400 }
      );
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }
    if (!datetime) {
      return NextResponse.json(
        { error: "datetime is required" },
        { status: 400 }
      );
    }

    const bookingDate = new Date(datetime);
    if (isNaN(bookingDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid datetime format" },
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

    // Check for conflicts — an existing non-canceled booking at the same datetime
    const conflict = await prisma.tourBooking.findFirst({
      where: {
        propertyId,
        date: bookingDate,
        status: { not: "canceled" },
      },
    });

    if (conflict) {
      return NextResponse.json(
        { error: "This time slot is no longer available. Please choose another time." },
        { status: 409 }
      );
    }

    // Create the tour booking
    const booking = await prisma.tourBooking.create({
      data: {
        propertyId,
        name: name.trim(),
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        date: bookingDate,
        notes: notes?.trim() || null,
        source: "web",
      },
    });

    // Send email notification to landlord (best-effort)
    try {
      const landlord = await prisma.user.findUnique({
        where: { id: property.userId },
        select: { email: true, name: true },
      });

      if (landlord) {
        const tourDate = bookingDate.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        const tourTime = bookingDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });

        const emailBody = [
          `${name.trim()} has scheduled a tour for ${property.name} (${property.address}).`,
          "",
          `Date: ${tourDate}`,
          `Time: ${tourTime}`,
          email ? `Email: ${email.trim()}` : "",
          phone ? `Phone: ${phone.trim()}` : "",
          notes ? `Notes: ${notes.trim()}` : "",
          "",
          "You can view and manage tour bookings in your dashboard.",
        ]
          .filter(Boolean)
          .join("\n");

        const emailSubject = `New Tour Booking - ${property.name}`;
        await sendEmail({
          to: landlord.email,
          subject: emailSubject,
          html: textToHtml(emailBody, emailSubject),
        });
      }
    } catch {
      // Don't fail the request if notification fails
    }

    // Send confirmation email to booker if email provided (best-effort)
    if (email?.trim()) {
      try {
        const tourDate = bookingDate.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        const tourTime = bookingDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });

        const confirmBody = [
          `Hi ${name.trim()},`,
          "",
          `Your tour has been confirmed for ${property.name}.`,
          "",
          `Date: ${tourDate}`,
          `Time: ${tourTime}`,
          `Address: ${property.address}`,
          "",
          "We look forward to showing you the property!",
        ].join("\n");

        const confirmSubject = `Tour Confirmed - ${property.name}`;
        await sendEmail({
          to: email.trim(),
          subject: confirmSubject,
          html: textToHtml(confirmBody, confirmSubject),
        });
      } catch {
        // Don't fail the request if confirmation email fails
      }
    }

    return NextResponse.json(
      {
        booking: {
          id: booking.id,
          date: booking.date,
          name: booking.name,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
