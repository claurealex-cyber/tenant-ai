/**
 * Pure computation utilities for tour slot availability.
 * No database access — used by both server (voice/SMS) and tenant-site (web).
 */

export interface TourSlotInput {
  dayOfWeek: number | null;
  specificDate: Date | null;
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  slotMinutes: number;
  isActive: boolean;
}

export interface TourBookingInput {
  date: Date;
  status: string;
}

export interface AvailableSlot {
  date: string; // ISO date string "YYYY-MM-DD"
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  datetime: string; // Full ISO datetime for booking
}

/**
 * Parse "HH:mm" string into { hours, minutes }.
 */
function parseTime(time: string): { hours: number; minutes: number } {
  const [h, m] = time.split(":").map(Number);
  return { hours: h, minutes: m };
}

/**
 * Format hours and minutes to "HH:mm".
 */
function formatTime(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Check if two dates are the same calendar day (UTC).
 */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Generate individual time slots from a start/end time and slot duration.
 */
function generateTimeSlots(
  startTime: string,
  endTime: string,
  slotMinutes: number,
): Array<{ startTime: string; endTime: string }> {
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  const startMinutes = start.hours * 60 + start.minutes;
  const endMinutes = end.hours * 60 + end.minutes;

  const slots: Array<{ startTime: string; endTime: string }> = [];
  for (let m = startMinutes; m + slotMinutes <= endMinutes; m += slotMinutes) {
    const sH = Math.floor(m / 60);
    const sM = m % 60;
    const eH = Math.floor((m + slotMinutes) / 60);
    const eM = (m + slotMinutes) % 60;
    slots.push({
      startTime: formatTime(sH, sM),
      endTime: formatTime(eH, eM),
    });
  }
  return slots;
}

/**
 * Compute available tour slots for a given date range.
 *
 * @param tourSlots - Active tour slot configurations from DB
 * @param existingBookings - Existing non-canceled bookings from DB
 * @param dateRange - Start and end dates to check
 * @returns Array of available time slots
 */
export function computeAvailableSlots(
  tourSlots: TourSlotInput[],
  existingBookings: TourBookingInput[],
  dateRange: { start: Date; end: Date },
): AvailableSlot[] {
  const activeSlots = tourSlots.filter((s) => s.isActive);
  if (activeSlots.length === 0) return [];

  // Build a set of booked datetimes (non-canceled) — use UTC for consistency
  const bookedTimes = new Set<string>();
  for (const booking of existingBookings) {
    if (booking.status === "canceled") continue;
    const d = new Date(booking.date);
    const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const timeStr = formatTime(d.getUTCHours(), d.getUTCMinutes());
    bookedTimes.add(`${dateStr}T${timeStr}`);
  }

  const available: AvailableSlot[] = [];
  const current = new Date(dateRange.start);
  // Zero out time in UTC
  current.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(dateRange.end);
  endDate.setUTCHours(23, 59, 59, 999);

  while (current <= endDate) {
    const dayOfWeek = current.getUTCDay();
    const dateStr = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}-${String(current.getUTCDate()).padStart(2, "0")}`;

    for (const slot of activeSlots) {
      let matches = false;

      // Check recurring weekly match
      if (slot.dayOfWeek !== null && slot.dayOfWeek === dayOfWeek) {
        matches = true;
      }

      // Check specific date match
      if (slot.specificDate && isSameDay(new Date(slot.specificDate), current)) {
        matches = true;
      }

      if (!matches) continue;

      // Generate individual time slots
      const timeSlots = generateTimeSlots(
        slot.startTime,
        slot.endTime,
        slot.slotMinutes,
      );

      for (const ts of timeSlots) {
        const key = `${dateStr}T${ts.startTime}`;
        if (!bookedTimes.has(key)) {
          const { hours, minutes } = parseTime(ts.startTime);
          const dt = new Date(Date.UTC(
            current.getUTCFullYear(),
            current.getUTCMonth(),
            current.getUTCDate(),
            hours,
            minutes,
            0,
            0,
          ));

          available.push({
            date: dateStr,
            startTime: ts.startTime,
            endTime: ts.endTime,
            datetime: dt.toISOString(),
          });
        }
      }
    }

    // Next day (UTC)
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return available;
}

/**
 * Format a day of week number to a human-readable name.
 */
export function dayOfWeekName(day: number): string {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[day] ?? "Unknown";
}
