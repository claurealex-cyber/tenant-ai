import { prisma } from "../lib/prisma.js";
import { computeAvailableSlots, type AvailableSlot } from "@tenant-ai/shared";
import { sendEmail } from "@tenant-ai/shared";

/**
 * Get available tour slots for a property.
 * Defaults to the next 7 days if no dates are specified.
 */
export async function getAvailableSlots(
  propertyId: string,
  preferredDate?: Date,
  endDate?: Date,
): Promise<AvailableSlot[]> {
  const start = preferredDate || new Date();
  const end = endDate || new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

  const tourSlots = await prisma.tourSlot.findMany({
    where: { propertyId, isActive: true },
  });

  const existingBookings = await prisma.tourBooking.findMany({
    where: {
      propertyId,
      date: { gte: start, lte: end },
      status: { not: "canceled" },
    },
    select: { date: true, status: true },
  });

  return computeAvailableSlots(
    tourSlots.map((s) => ({
      dayOfWeek: s.dayOfWeek,
      specificDate: s.specificDate,
      startTime: s.startTime,
      endTime: s.endTime,
      slotMinutes: s.slotMinutes,
      isActive: s.isActive,
    })),
    existingBookings,
    { start, end },
  );
}

/**
 * Book a tour at a property.
 * Checks for conflicts before creating.
 */
export async function bookTour(
  propertyId: string,
  name: string,
  phone: string | null,
  email: string | null,
  datetime: Date,
  source: "web" | "voice" | "sms",
) {
  // Check for conflicts (another booking at the same time)
  const existing = await prisma.tourBooking.findFirst({
    where: {
      propertyId,
      date: datetime,
      status: { not: "canceled" },
    },
  });

  if (existing) {
    throw new Error("This time slot is no longer available. Please select another.");
  }

  const booking = await prisma.tourBooking.create({
    data: {
      propertyId,
      name,
      phone,
      email,
      date: datetime,
      source,
    },
    include: { property: { select: { name: true, address: true, userId: true, user: { select: { email: true } } } } },
  });

  // Notify landlord
  try {
    const landlordEmail = booking.property.user.email;
    if (landlordEmail) {
      await sendEmail({
        to: landlordEmail,
        subject: `New Tour Booking - ${booking.property.name}`,
        html: `
          <h2>New Tour Scheduled</h2>
          <p><strong>Property:</strong> ${booking.property.name}</p>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Date:</strong> ${datetime.toLocaleDateString()} at ${datetime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
          ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ""}
          ${email ? `<p><strong>Email:</strong> ${email}</p>` : ""}
          <p><strong>Source:</strong> ${source}</p>
        `,
      });
    }
  } catch {
    // Don't fail the booking if notification fails
  }

  // Send confirmation to booker
  if (email) {
    try {
      await sendEmail({
        to: email,
        subject: `Tour Confirmed - ${booking.property.name}`,
        html: `
          <h2>Your Tour is Confirmed!</h2>
          <p>You have a tour scheduled at <strong>${booking.property.name}</strong>.</p>
          <p><strong>Date:</strong> ${datetime.toLocaleDateString()} at ${datetime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
          <p><strong>Address:</strong> ${booking.property.address}</p>
          <p>If you need to cancel, please visit the property website or call the property.</p>
        `,
      });
    } catch {
      // Don't fail the booking if confirmation email fails
    }
  }

  return booking;
}

/**
 * Cancel a tour booking.
 */
export async function cancelTourBooking(bookingId: string) {
  const booking = await prisma.tourBooking.update({
    where: { id: bookingId },
    data: { status: "canceled" },
    include: { property: { select: { name: true, userId: true, user: { select: { email: true } } } } },
  });

  // Notify landlord
  try {
    const landlordEmail = booking.property.user.email;
    if (landlordEmail) {
      await sendEmail({
        to: landlordEmail,
        subject: `Tour Canceled - ${booking.property.name}`,
        html: `
          <h2>Tour Canceled</h2>
          <p><strong>Property:</strong> ${booking.property.name}</p>
          <p><strong>Name:</strong> ${booking.name}</p>
          <p><strong>Original Date:</strong> ${booking.date.toLocaleDateString()} at ${booking.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
        `,
      });
    }
  } catch {
    // Don't fail the cancellation if notification fails
  }

  return booking;
}
