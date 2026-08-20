/**
 * Late fee service.
 *
 * Checks for overdue unpaid RentCharges past their grace period
 * and creates late_fee RentCharge records. Enforces IL minimum
 * 5-day grace period and Cook County RTLO fee cap.
 */

import { prisma } from "../lib/prisma.js";
import {
  getCookCountyLateFeeMax,
  IL_GRACE_PERIOD_MIN,
} from "@tenant-ai/shared";
import { sendNotification } from "./notifications.js";

/**
 * Calculate and create late fee charges for all overdue rent charges.
 *
 * - Only applies to active leases with a configured lateFeeAmount
 * - Respects IL minimum 5-day grace period
 * - Enforces Cook County RTLO cap
 * - Idempotent: uses @@unique(leaseId, forMonth, type) to prevent duplicates
 *
 * @returns Number of late fee charges created
 */
export async function calculateLateFees(
  date: Date = new Date()
): Promise<number> {
  // Find unpaid rent charges past their grace period
  const overdueCharges = await prisma.rentCharge.findMany({
    where: {
      type: "rent",
      status: { in: ["unpaid", "partial"] },
    },
    include: {
      lease: {
        select: {
          id: true,
          status: true,
          lateFeeAmount: true,
          lateFeeGraceDays: true,
          monthlyRent: true,
          tenant: {
            select: { email: true, firstName: true, lastName: true },
          },
          unit: {
            select: {
              property: {
                select: {
                  cookCounty: true,
                  name: true,
                  user: { select: { email: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  let created = 0;

  for (const charge of overdueCharges) {
    const lease = charge.lease;

    // Skip non-active leases
    if (lease.status !== "active") continue;

    // Skip if no late fee configured
    if (!lease.lateFeeAmount || lease.lateFeeAmount <= 0) continue;

    // Calculate grace period end date
    const graceDays = Math.max(
      lease.lateFeeGraceDays,
      IL_GRACE_PERIOD_MIN
    );
    const dueDate = new Date(charge.dueDate);
    const graceEndDate = new Date(dueDate);
    graceEndDate.setUTCDate(graceEndDate.getUTCDate() + graceDays);

    // Skip if still within grace period
    if (date <= graceEndDate) continue;

    // Determine late fee amount (enforce Cook County cap)
    let feeAmount = lease.lateFeeAmount;
    const isCookCounty = lease.unit.property.cookCounty;

    if (isCookCounty) {
      const cap = getCookCountyLateFeeMax(lease.monthlyRent);
      feeAmount = Math.min(feeAmount, cap);
    }

    // Create late fee charge (idempotent via unique constraint)
    try {
      await prisma.rentCharge.create({
        data: {
          leaseId: lease.id,
          amount: feeAmount,
          type: "late_fee",
          forMonth: charge.forMonth,
          dueDate: date, // Due immediately
          description: `Late fee for ${charge.forMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
        },
      });
      created++;

      // Notify tenant + landlord about late fee (best-effort)
      try {
        const tenant = lease.tenant;
        const landlord = lease.unit.property.user;
        const feeStr = `$${(feeAmount / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const monthStr = charge.forMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
        const propName = lease.unit.property.name;

        await sendNotification({
          type: "late_fee_applied",
          recipientEmail: tenant.email,
          recipientName: `${tenant.firstName} ${tenant.lastName}`,
          subject: `Late fee of ${feeStr} applied`,
          body: `Hi ${tenant.firstName},\n\nA late fee of ${feeStr} has been applied for ${monthStr} rent at ${propName}.\n\nPlease log in to your tenant portal to view your balance and make a payment.`,
          metadata: { leaseId: lease.id, amount: feeAmount },
        });

        await sendNotification({
          type: "late_fee_applied",
          recipientEmail: landlord.email,
          recipientName: landlord.name || landlord.email,
          subject: `Late fee applied for ${tenant.firstName} ${tenant.lastName}`,
          body: `A late fee of ${feeStr} has been applied for ${monthStr} rent for ${tenant.firstName} ${tenant.lastName} at ${propName}.`,
          metadata: { leaseId: lease.id, tenantId: tenant.email },
        });
      } catch (notifyErr) {
        console.error("[late-fees] Notification error:", notifyErr);
      }
    } catch (err: any) {
      // P2002 = unique constraint violation → late fee already exists
      if (err?.code === "P2002") {
        continue;
      }
      throw err;
    }
  }

  return created;
}
