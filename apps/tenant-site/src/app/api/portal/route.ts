import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/portal — tenant dashboard data.
 *
 * Returns: current balance, next due date, active notices, unread messages.
 */
export async function GET() {
  const session = await getServerSession(tenantAuthOptions);
  if (!session?.tenant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.tenant.id;

  // Find active lease
  const lease = await prisma.lease.findFirst({
    where: { tenantId, status: "active" },
    include: {
      unit: {
        include: {
          property: { select: { name: true, address: true } },
        },
      },
    },
  });

  if (!lease) {
    // Still count maintenance requests even without an active lease
    const maintenanceCount = await prisma.maintenanceRequest.count({
      where: { tenantId, status: { in: ["open", "in_progress"] } },
    });

    // Next confirmed tour booking for this tenant (match by email or phone)
    const tenantNoLease = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { email: true, phone: true },
    });

    let upcomingTourNoLease: { id: string; date: Date; propertyName: string } | null = null;
    if (tenantNoLease) {
      const tourWhereNoLease: any[] = [];
      if (tenantNoLease.email) tourWhereNoLease.push({ email: tenantNoLease.email });
      if (tenantNoLease.phone) tourWhereNoLease.push({ phone: tenantNoLease.phone });

      if (tourWhereNoLease.length > 0) {
        const tour = await prisma.tourBooking.findFirst({
          where: {
            status: "confirmed",
            date: { gte: new Date() },
            OR: tourWhereNoLease,
          },
          orderBy: { date: "asc" },
          include: { property: { select: { name: true } } },
        });

        if (tour) {
          upcomingTourNoLease = {
            id: tour.id,
            date: tour.date,
            propertyName: tour.property.name,
          };
        }
      }
    }

    return NextResponse.json({
      lease: null,
      balance: 0,
      nextDueDate: null,
      overdueAmount: 0,
      unreadNotices: 0,
      unreadMessages: 0,
      maintenanceCount,
      upcomingTour: upcomingTourNoLease,
    });
  }

  // Outstanding balance
  const charges = await prisma.rentCharge.findMany({
    where: { leaseId: lease.id, status: { in: ["unpaid", "partial"] } },
  });
  const balance = charges.reduce(
    (sum, c) => sum + (c.amount - c.paidAmount),
    0
  );

  // Overdue amount
  const now = new Date();
  const overdueCharges = charges.filter((c) => c.dueDate < now);
  const overdueAmount = overdueCharges.reduce(
    (sum, c) => sum + (c.amount - c.paidAmount),
    0
  );

  // Next due date
  const nextCharge = await prisma.rentCharge.findFirst({
    where: {
      leaseId: lease.id,
      status: { in: ["unpaid", "partial"] },
      dueDate: { gte: now },
    },
    orderBy: { dueDate: "asc" },
  });

  // Unread notices
  const unreadNotices = await prisma.notice.count({
    where: { tenantId, visibleInPortal: true },
  });

  // Unread messages
  const unreadMessages = await prisma.message.count({
    where: { tenantId, isRead: false },
  });

  // Open/in-progress maintenance requests
  const maintenanceCount = await prisma.maintenanceRequest.count({
    where: { tenantId, status: { in: ["open", "in_progress"] } },
  });

  // Next confirmed tour booking for this tenant (match by email or phone)
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { email: true, phone: true },
  });

  let upcomingTour: { id: string; date: Date; propertyName: string } | null = null;
  if (tenant) {
    const tourWhere: any[] = [];
    if (tenant.email) tourWhere.push({ email: tenant.email });
    if (tenant.phone) tourWhere.push({ phone: tenant.phone });

    if (tourWhere.length > 0) {
      const tour = await prisma.tourBooking.findFirst({
        where: {
          status: "confirmed",
          date: { gte: new Date() },
          OR: tourWhere,
        },
        orderBy: { date: "asc" },
        include: { property: { select: { name: true } } },
      });

      if (tour) {
        upcomingTour = {
          id: tour.id,
          date: tour.date,
          propertyName: tour.property.name,
        };
      }
    }
  }

  return NextResponse.json({
    lease: {
      id: lease.id,
      monthlyRent: lease.monthlyRent,
      startDate: lease.startDate,
      endDate: lease.endDate,
      rentDueDay: lease.rentDueDay,
      unit: lease.unit.unitNumber,
      property: lease.unit.property.name,
      address: lease.unit.property.address,
    },
    balance,
    nextDueDate: nextCharge?.dueDate ?? null,
    nextDueAmount: nextCharge ? nextCharge.amount - nextCharge.paidAmount : 0,
    overdueAmount,
    unreadNotices,
    unreadMessages,
    maintenanceCount,
    upcomingTour,
  });
}
