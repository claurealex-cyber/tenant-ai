import { describe, it, expect, vi, beforeEach } from "vitest";

const TEST_PREFIX = `test_tour_${Date.now()}`;

// --------------- Mocks ---------------

const mockSendEmail = vi.fn().mockResolvedValue(undefined);
const mockComputeAvailableSlots = vi.fn().mockReturnValue([]);

vi.mock("@tenant-ai/shared", () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
  computeAvailableSlots: (...args: any[]) => mockComputeAvailableSlots(...args),
}));

const mockTourSlotFindMany = vi.fn().mockResolvedValue([]);
const mockTourBookingFindMany = vi.fn().mockResolvedValue([]);
const mockTourBookingFindFirst = vi.fn().mockResolvedValue(null);
const mockTourBookingCreate = vi.fn();
const mockTourBookingUpdate = vi.fn();

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    tourSlot: {
      findMany: (...args: any[]) => mockTourSlotFindMany(...args),
    },
    tourBooking: {
      findMany: (...args: any[]) => mockTourBookingFindMany(...args),
      findFirst: (...args: any[]) => mockTourBookingFindFirst(...args),
      create: (...args: any[]) => mockTourBookingCreate(...args),
      update: (...args: any[]) => mockTourBookingUpdate(...args),
    },
  },
}));

import {
  getAvailableSlots,
  bookTour,
  cancelTourBooking,
} from "../services/tour-service.js";

// --------------- Helpers ---------------

const PROPERTY_ID = `${TEST_PREFIX}_prop_1`;
const BOOKING_ID = `${TEST_PREFIX}_booking_1`;

function makeFakeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    propertyId: PROPERTY_ID,
    name: "Jane Doe",
    phone: "(312) 555-0100",
    email: "jane@test.com",
    date: new Date("2025-06-15T10:00:00Z"),
    source: "web",
    status: "confirmed",
    property: {
      name: "Oak Apartments",
      address: "123 Main St",
      userId: "user-1",
      user: { email: "landlord@test.com" },
    },
    ...overrides,
  };
}

// --------------- Tests ---------------

describe("tour-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===== getAvailableSlots =====

  describe("getAvailableSlots", () => {
    it("calls computeAvailableSlots with correct args", async () => {
      const slots = [
        {
          id: "slot-1",
          dayOfWeek: 1,
          specificDate: null,
          startTime: "09:00",
          endTime: "17:00",
          slotMinutes: 30,
          isActive: true,
        },
      ];
      mockTourSlotFindMany.mockResolvedValue(slots);

      const existingBookings = [
        { date: new Date("2025-06-10T10:00:00Z"), status: "confirmed" },
      ];
      mockTourBookingFindMany.mockResolvedValue(existingBookings);

      const preferredDate = new Date("2025-06-10T00:00:00Z");
      const endDate = new Date("2025-06-17T00:00:00Z");

      mockComputeAvailableSlots.mockReturnValue([
        { date: "2025-06-11", time: "09:00" },
      ]);

      const result = await getAvailableSlots(PROPERTY_ID, preferredDate, endDate);

      // tourSlot.findMany called with propertyId and isActive: true
      expect(mockTourSlotFindMany).toHaveBeenCalledWith({
        where: { propertyId: PROPERTY_ID, isActive: true },
      });

      // tourBooking.findMany called with propertyId, date range, not canceled
      expect(mockTourBookingFindMany).toHaveBeenCalledWith({
        where: {
          propertyId: PROPERTY_ID,
          date: { gte: preferredDate, lte: endDate },
          status: { not: "canceled" },
        },
        select: { date: true, status: true },
      });

      // computeAvailableSlots called with mapped slots, bookings, and range
      expect(mockComputeAvailableSlots).toHaveBeenCalledWith(
        [
          {
            dayOfWeek: 1,
            specificDate: null,
            startTime: "09:00",
            endTime: "17:00",
            slotMinutes: 30,
            isActive: true,
          },
        ],
        existingBookings,
        { start: preferredDate, end: endDate },
      );

      expect(result).toEqual([{ date: "2025-06-11", time: "09:00" }]);
    });

    it("defaults to 7-day range when no dates provided", async () => {
      mockTourSlotFindMany.mockResolvedValue([]);
      mockTourBookingFindMany.mockResolvedValue([]);
      mockComputeAvailableSlots.mockReturnValue([]);

      const before = Date.now();
      await getAvailableSlots(PROPERTY_ID);
      const after = Date.now();

      // Verify the date range passed to tourBooking.findMany
      const bookingCall = mockTourBookingFindMany.mock.calls[0][0];
      const start = bookingCall.where.date.gte as Date;
      const end = bookingCall.where.date.lte as Date;

      // start should be ~now
      expect(start.getTime()).toBeGreaterThanOrEqual(before);
      expect(start.getTime()).toBeLessThanOrEqual(after);

      // end should be ~7 days after start
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const diff = end.getTime() - start.getTime();
      expect(diff).toBe(sevenDaysMs);
    });
  });

  // ===== bookTour =====

  describe("bookTour", () => {
    it("creates booking when no conflict", async () => {
      mockTourBookingFindFirst.mockResolvedValue(null);
      const fakeBooking = makeFakeBooking();
      mockTourBookingCreate.mockResolvedValue(fakeBooking);

      const datetime = new Date("2025-06-15T10:00:00Z");
      const result = await bookTour(
        PROPERTY_ID,
        "Jane Doe",
        "(312) 555-0100",
        "jane@test.com",
        datetime,
        "web",
      );

      expect(mockTourBookingFindFirst).toHaveBeenCalledWith({
        where: {
          propertyId: PROPERTY_ID,
          date: datetime,
          status: { not: "canceled" },
        },
      });

      expect(mockTourBookingCreate).toHaveBeenCalledWith({
        data: {
          propertyId: PROPERTY_ID,
          name: "Jane Doe",
          phone: "(312) 555-0100",
          email: "jane@test.com",
          date: datetime,
          source: "web",
        },
        include: {
          property: {
            select: {
              name: true,
              address: true,
              userId: true,
              user: { select: { email: true } },
            },
          },
        },
      });

      expect(result).toEqual(fakeBooking);
    });

    it("throws when conflict exists", async () => {
      mockTourBookingFindFirst.mockResolvedValue({
        id: "existing-booking",
        propertyId: PROPERTY_ID,
        date: new Date("2025-06-15T10:00:00Z"),
        status: "confirmed",
      });

      const datetime = new Date("2025-06-15T10:00:00Z");

      await expect(
        bookTour(PROPERTY_ID, "Jane Doe", null, null, datetime, "web"),
      ).rejects.toThrow("This time slot is no longer available");

      expect(mockTourBookingCreate).not.toHaveBeenCalled();
    });

    it("sends landlord notification email", async () => {
      mockTourBookingFindFirst.mockResolvedValue(null);
      const fakeBooking = makeFakeBooking();
      mockTourBookingCreate.mockResolvedValue(fakeBooking);

      const datetime = new Date("2025-06-15T10:00:00Z");
      await bookTour(
        PROPERTY_ID,
        "Jane Doe",
        "(312) 555-0100",
        "jane@test.com",
        datetime,
        "web",
      );

      // First sendEmail call is landlord notification
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "landlord@test.com",
          subject: "New Tour Booking - Oak Apartments",
        }),
      );

      // Verify HTML contains relevant info
      const landlordCall = mockSendEmail.mock.calls.find(
        (c: any[]) => c[0].to === "landlord@test.com",
      );
      expect(landlordCall).toBeDefined();
      expect(landlordCall![0].html).toContain("Jane Doe");
      expect(landlordCall![0].html).toContain("Oak Apartments");
    });

    it("sends confirmation email to booker when email provided", async () => {
      mockTourBookingFindFirst.mockResolvedValue(null);
      const fakeBooking = makeFakeBooking();
      mockTourBookingCreate.mockResolvedValue(fakeBooking);

      const datetime = new Date("2025-06-15T10:00:00Z");
      await bookTour(
        PROPERTY_ID,
        "Jane Doe",
        "(312) 555-0100",
        "jane@test.com",
        datetime,
        "web",
      );

      // Second sendEmail call is booker confirmation
      const bookerCall = mockSendEmail.mock.calls.find(
        (c: any[]) => c[0].to === "jane@test.com",
      );
      expect(bookerCall).toBeDefined();
      expect(bookerCall![0].subject).toContain("Tour Confirmed");
      expect(bookerCall![0].html).toContain("Oak Apartments");
      expect(bookerCall![0].html).toContain("123 Main St");
    });

    it("skips confirmation email when no email provided", async () => {
      mockTourBookingFindFirst.mockResolvedValue(null);
      const fakeBooking = makeFakeBooking({ email: null });
      mockTourBookingCreate.mockResolvedValue(fakeBooking);

      const datetime = new Date("2025-06-15T10:00:00Z");
      await bookTour(
        PROPERTY_ID,
        "Jane Doe",
        "(312) 555-0100",
        null,
        datetime,
        "voice",
      );

      // Only the landlord notification should be sent (1 call)
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "landlord@test.com" }),
      );
    });
  });

  // ===== cancelTourBooking =====

  describe("cancelTourBooking", () => {
    it("updates status to canceled", async () => {
      const fakeBooking = makeFakeBooking({ status: "canceled" });
      mockTourBookingUpdate.mockResolvedValue(fakeBooking);

      const result = await cancelTourBooking(BOOKING_ID);

      expect(mockTourBookingUpdate).toHaveBeenCalledWith({
        where: { id: BOOKING_ID },
        data: { status: "canceled" },
        include: {
          property: {
            select: {
              name: true,
              userId: true,
              user: { select: { email: true } },
            },
          },
        },
      });

      expect(result.status).toBe("canceled");
    });

    it("sends cancellation notification to landlord", async () => {
      const fakeBooking = makeFakeBooking({ status: "canceled" });
      mockTourBookingUpdate.mockResolvedValue(fakeBooking);

      await cancelTourBooking(BOOKING_ID);

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "landlord@test.com",
          subject: "Tour Canceled - Oak Apartments",
        }),
      );

      const emailCall = mockSendEmail.mock.calls[0];
      expect(emailCall[0].html).toContain("Tour Canceled");
      expect(emailCall[0].html).toContain("Jane Doe");
      expect(emailCall[0].html).toContain("Oak Apartments");
    });
  });
});
