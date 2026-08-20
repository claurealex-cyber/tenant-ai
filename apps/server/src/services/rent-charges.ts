/**
 * Rent charge service.
 *
 * Creates monthly RentCharge records for active leases and applies
 * payments to outstanding charges using FIFO ordering.
 */

import { prisma } from "../lib/prisma.js";

// ── Rent Charge Creation ──

/**
 * Post rent charges for all active leases whose rentDueDay matches today.
 *
 * - Skips leases that already have a charge for this month+type (@@unique constraint).
 * - Returns the count of new charges created.
 */
export async function postRentCharges(date: Date = new Date()): Promise<number> {
  const today = date.getDate();
  const forMonth = new Date(date.getFullYear(), date.getMonth(), 1);

  // Find active leases where today is the rent due day
  const leases = await prisma.lease.findMany({
    where: {
      status: "active",
      rentDueDay: today,
    },
    select: {
      id: true,
      monthlyRent: true,
      rentDueDay: true,
    },
  });

  let created = 0;

  for (const lease of leases) {
    try {
      const dueDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), lease.rentDueDay));

      await prisma.rentCharge.create({
        data: {
          leaseId: lease.id,
          amount: lease.monthlyRent,
          type: "rent",
          forMonth,
          dueDate,
          description: `Rent for ${forMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
        },
      });

      created++;
    } catch (err: any) {
      // P2002 = unique constraint violation → charge already exists for this month
      if (err?.code === "P2002") {
        continue;
      }
      throw err;
    }
  }

  return created;
}

// ── Payment Application (FIFO) ──

/**
 * Apply a payment amount to the oldest outstanding RentCharges for a lease.
 *
 * Processes charges in order of dueDate (oldest first).
 * Updates paidAmount and status on each charge.
 *
 * @returns Array of charge IDs that were fully or partially paid
 */
export async function applyPaymentToCharges(
  leaseId: string,
  amountCents: number
): Promise<{ chargeId: string; applied: number }[]> {
  const charges = await prisma.rentCharge.findMany({
    where: {
      leaseId,
      status: { in: ["unpaid", "partial"] },
    },
    orderBy: { dueDate: "asc" },
  });

  let remaining = amountCents;
  const applied: { chargeId: string; applied: number }[] = [];

  for (const charge of charges) {
    if (remaining <= 0) break;

    const owed = charge.amount - charge.paidAmount;
    const toApply = Math.min(remaining, owed);

    const newPaidAmount = charge.paidAmount + toApply;
    const newStatus = newPaidAmount >= charge.amount ? "paid" : "partial";

    await prisma.rentCharge.update({
      where: { id: charge.id },
      data: {
        paidAmount: newPaidAmount,
        status: newStatus,
      },
    });

    applied.push({ chargeId: charge.id, applied: toApply });
    remaining -= toApply;
  }

  return applied;
}

// ── Balance Calculation ──

/**
 * Calculate the outstanding balance for a lease.
 *
 * @returns Total amount owed in cents (sum of amount - paidAmount for unpaid/partial charges)
 */
export async function getLeaseBalance(leaseId: string): Promise<number> {
  const result = await prisma.rentCharge.aggregate({
    where: {
      leaseId,
      status: { in: ["unpaid", "partial"] },
    },
    _sum: {
      amount: true,
      paidAmount: true,
    },
  });

  const totalAmount = result._sum.amount ?? 0;
  const totalPaid = result._sum.paidAmount ?? 0;

  return totalAmount - totalPaid;
}
