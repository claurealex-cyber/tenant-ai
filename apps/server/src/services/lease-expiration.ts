/**
 * Lease expiration monitoring — detect expiring leases, auto-convert,
 * send reminders.
 *
 * Called by a daily BullMQ job.
 */

import { prisma } from "../lib/prisma.js";
import { sendNotification } from "./notifications.js";

// ── Types ──

export interface LeaseExpirationResult {
  reminders: number;
  autoConverted: number;
}

// ── Main Job ──

/**
 * Check all leases for upcoming expiration and handle appropriately:
 *
 * 1. Leases expiring within 30 days → send reminder to landlord
 * 2. Leases already expired (fixed term) → auto-convert to month-to-month
 */
export async function checkLeaseExpirations(): Promise<LeaseExpirationResult> {
  const now = new Date();
  let reminders = 0;
  let autoConverted = 0;

  // 1. Find fixed leases expiring within 30 days (not yet expired)
  const thirtyDaysOut = new Date(now);
  thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);

  const expiringSoon = await prisma.lease.findMany({
    where: {
      status: "active",
      leaseType: "fixed",
      endDate: {
        not: null,
        lte: thirtyDaysOut,
        gt: now,
      },
    },
    include: {
      tenant: true,
      unit: { include: { property: { include: { user: true } } } },
    },
  });

  for (const lease of expiringSoon) {
    const daysUntil = Math.ceil(
      (lease.endDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    const landlord = lease.unit.property.user;
    const tenantName = `${lease.tenant.firstName} ${lease.tenant.lastName}`;

    await sendNotification({
      type: "lease_expiring",
      recipientEmail: landlord.email,
      recipientName: landlord.name || landlord.email,
      subject: `Lease for ${tenantName} expires in ${daysUntil} days`,
      body: [
        `The lease for ${tenantName} in ${lease.unit.property.name}, Unit ${lease.unit.unitNumber} expires on ${lease.endDate!.toLocaleDateString("en-US")}.`,
        "",
        `Days remaining: ${daysUntil}`,
        "",
        "Actions you can take:",
        "- Renew the lease (extend the end date)",
        "- Convert to month-to-month",
        "- Send a 30-day termination notice",
        "",
        "If no action is taken, the lease will automatically convert to month-to-month upon expiration.",
      ].join("\n"),
      metadata: { leaseId: lease.id, daysUntil },
    });

    reminders++;
  }

  // 2. Auto-convert expired fixed leases to month-to-month
  const expiredLeases = await prisma.lease.findMany({
    where: {
      status: "active",
      leaseType: "fixed",
      endDate: {
        not: null,
        lte: now,
      },
    },
    include: {
      tenant: true,
      unit: { include: { property: { include: { user: true } } } },
    },
  });

  for (const lease of expiredLeases) {
    await prisma.lease.update({
      where: { id: lease.id },
      data: {
        leaseType: "month_to_month",
        endDate: null,
      },
    });

    const landlord = lease.unit.property.user;
    const tenantName = `${lease.tenant.firstName} ${lease.tenant.lastName}`;

    await sendNotification({
      type: "lease_expiring",
      recipientEmail: landlord.email,
      recipientName: landlord.name || landlord.email,
      subject: `Lease for ${tenantName} auto-converted to month-to-month`,
      body: [
        `The fixed-term lease for ${tenantName} in ${lease.unit.property.name}, Unit ${lease.unit.unitNumber} has expired and been automatically converted to month-to-month.`,
        "",
        "Rent charges will continue to be generated monthly.",
        "You can send a 30-day notice to terminate the tenancy at any time.",
      ].join("\n"),
      metadata: { leaseId: lease.id },
    });

    autoConverted++;
  }

  return { reminders, autoConverted };
}

/**
 * Renew a lease — extend the end date while keeping it fixed-term.
 */
export async function renewLease(
  leaseId: string,
  newEndDate: Date
): Promise<void> {
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!lease) throw new Error("Lease not found");
  if (lease.status !== "active") throw new Error("Only active leases can be renewed");

  await prisma.lease.update({
    where: { id: leaseId },
    data: {
      endDate: newEndDate,
      leaseType: "fixed",
    },
  });
}

/**
 * Terminate a lease — stops rent charge generation.
 */
export async function terminateLease(
  leaseId: string,
  moveOutDate?: Date
): Promise<void> {
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!lease) throw new Error("Lease not found");

  await prisma.lease.update({
    where: { id: leaseId },
    data: {
      status: "terminated",
      moveOutDate: moveOutDate ?? new Date(),
    },
  });

  // Update unit status back to vacant
  await prisma.unit.update({
    where: { id: lease.unitId },
    data: { status: "vacant" },
  });
}
