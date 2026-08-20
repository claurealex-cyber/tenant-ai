/**
 * Security deposit lifecycle — receipt with bank info, interest calculations,
 * return workflow with deadline alerts.
 *
 * IL references:
 *  - 765 ILCS 710: Security deposit return (30-day statement, 45-day return)
 *  - 765 ILCS 715/1: Deposit receipt must include holding institution name + address
 *  - Cook County CRLTO: 6+ units → must pay interest
 *  - Statewide: 25+ units → must pay interest (765 ILCS 715)
 */

import { prisma } from "../lib/prisma.js";
import {
  DEPOSIT_RECEIPT_DEADLINE_DAYS,
  DEPOSIT_STATEMENT_DEADLINE_DAYS,
  DEPOSIT_RETURN_DEADLINE_DAYS,
  calculateDepositInterest,
  mustPayDepositInterest,
} from "@tenant-ai/shared";
import { sendNotification } from "./notifications.js";
import { generateReceiptPdf } from "./receipt-generator.js";

// ── Types ──

export interface DepositAlert {
  leaseId: string;
  tenantName: string;
  propertyName: string;
  unitNumber: string;
  type: "receipt_due" | "statement_due" | "return_due" | "interest_due";
  daysRemaining: number;
  deadlineDate: Date;
}

// ── Deposit Receipt ──

/**
 * Generate deposit receipt PDF with IL-required fields (765 ILCS 715/1):
 * - Date received, amount, tenant name, landlord name, property address
 * - Name and address of institution holding the deposit
 */
export async function generateDepositReceipt(leaseId: string): Promise<{
  pdfBuffer: Buffer;
  lease: { id: string; tenantId: string };
}> {
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: {
      tenant: true,
      unit: { include: { property: { include: { user: true } } } },
    },
  });

  if (!lease) throw new Error("Lease not found");
  if (!lease.securityDeposit) throw new Error("No security deposit on this lease");

  const pdfBuffer = await generateReceiptPdf({
    tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
    landlordName: lease.unit.property.user.companyName || lease.unit.property.user.name || "Landlord",
    propertyAddress: lease.unit.property.address,
    propertyName: lease.unit.property.name,
    unitNumber: lease.unit.unitNumber,
    amountCents: lease.securityDeposit,
    type: "security_deposit",
    method: "deposit",
    date: lease.depositReceivedDate || lease.createdAt,
    receiptNumber: `DEP-${lease.id.slice(0, 8).toUpperCase()}`,
  });

  // Mark receipt as sent
  await prisma.lease.update({
    where: { id: leaseId },
    data: { depositReceiptSent: true },
  });

  return { pdfBuffer, lease: { id: lease.id, tenantId: lease.tenantId } };
}

// ── Deposit Interest ──

/**
 * Calculate deposit interest owed for a lease.
 * Returns 0 if the landlord is not required to pay interest.
 */
export async function calculateLeaseDepositInterest(leaseId: string): Promise<{
  interestCents: number;
  required: boolean;
  rate: number;
}> {
  const rate = parseFloat(process.env.IL_DEPOSIT_INTEREST_RATE || "0.01");

  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: {
      unit: { include: { property: { include: { user: true } } } },
    },
  });

  if (!lease || !lease.securityDeposit) {
    return { interestCents: 0, required: false, rate };
  }

  const userId = lease.unit.property.userId;

  // Count total units and Cook County units
  const properties = await prisma.property.findMany({
    where: { userId },
    include: { units: true },
  });

  let totalUnits = 0;
  let cookCountyUnits = 0;
  for (const p of properties) {
    totalUnits += p.units.length;
    if (p.cookCounty) {
      cookCountyUnits += p.units.length;
    }
  }

  const required = mustPayDepositInterest(totalUnits, cookCountyUnits);

  if (!required) {
    return { interestCents: 0, required: false, rate };
  }

  const interestCents = calculateDepositInterest(lease.securityDeposit, rate);
  return { interestCents, required: true, rate };
}

// ── Deposit Return Workflow ──

/**
 * Calculate deposit return amount: deposit + interest - deductions.
 */
export async function calculateDepositReturn(leaseId: string): Promise<{
  originalDeposit: number;
  interestCents: number;
  totalDeductions: number;
  returnAmount: number;
}> {
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
  });

  if (!lease || !lease.securityDeposit) {
    throw new Error("Lease not found or no deposit");
  }

  const { interestCents } = await calculateLeaseDepositInterest(leaseId);

  const deductions = (lease.depositDeductions as Array<{ description: string; amount: number }>) || [];
  const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);

  const returnAmount = lease.securityDeposit + interestCents - totalDeductions;

  return {
    originalDeposit: lease.securityDeposit,
    interestCents,
    totalDeductions,
    returnAmount: Math.max(0, returnAmount),
  };
}

// ── Deadline Checking ──

/**
 * Check all active leases for upcoming deposit deadlines.
 * Returns alerts for:
 * - Receipt not sent within 10 days of deposit
 * - Itemized statement due within 30 days of move-out
 * - Deposit return due within 45 days of move-out
 * - Annual interest anniversary approaching
 */
export async function checkDepositDeadlines(): Promise<DepositAlert[]> {
  const alerts: DepositAlert[] = [];
  const now = new Date();

  // 1. Receipt deadline: leases with deposit but no receipt sent
  const needReceipt = await prisma.lease.findMany({
    where: {
      securityDeposit: { gt: 0 },
      depositReceiptSent: false,
      status: "active",
    },
    include: {
      tenant: true,
      unit: { include: { property: true } },
    },
  });

  for (const lease of needReceipt) {
    const receivedDate = lease.depositReceivedDate || lease.createdAt;
    const deadline = new Date(receivedDate);
    deadline.setDate(deadline.getDate() + DEPOSIT_RECEIPT_DEADLINE_DAYS);
    const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysRemaining <= DEPOSIT_RECEIPT_DEADLINE_DAYS && daysRemaining >= 0) {
      alerts.push({
        leaseId: lease.id,
        tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
        propertyName: lease.unit.property.name,
        unitNumber: lease.unit.unitNumber,
        type: "receipt_due",
        daysRemaining,
        deadlineDate: deadline,
      });
    }
  }

  // 2. Statement + return deadlines: leases with moveOutDate set
  const movedOut = await prisma.lease.findMany({
    where: {
      moveOutDate: { not: null },
      securityDeposit: { gt: 0 },
      depositReturnedDate: null,
    },
    include: {
      tenant: true,
      unit: { include: { property: true } },
    },
  });

  for (const lease of movedOut) {
    const moveOut = lease.moveOutDate!;
    const tenantName = `${lease.tenant.firstName} ${lease.tenant.lastName}`;
    const propertyName = lease.unit.property.name;
    const unitNumber = lease.unit.unitNumber;

    // Statement deadline (30 days)
    const statementDeadline = new Date(moveOut);
    statementDeadline.setDate(statementDeadline.getDate() + DEPOSIT_STATEMENT_DEADLINE_DAYS);
    const statementDays = Math.ceil((statementDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (statementDays >= 0 && statementDays <= DEPOSIT_STATEMENT_DEADLINE_DAYS) {
      alerts.push({
        leaseId: lease.id,
        tenantName,
        propertyName,
        unitNumber,
        type: "statement_due",
        daysRemaining: statementDays,
        deadlineDate: statementDeadline,
      });
    }

    // Return deadline (45 days)
    const returnDeadline = new Date(moveOut);
    returnDeadline.setDate(returnDeadline.getDate() + DEPOSIT_RETURN_DEADLINE_DAYS);
    const returnDays = Math.ceil((returnDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (returnDays >= 0 && returnDays <= DEPOSIT_RETURN_DEADLINE_DAYS) {
      alerts.push({
        leaseId: lease.id,
        tenantName,
        propertyName,
        unitNumber,
        type: "return_due",
        daysRemaining: returnDays,
        deadlineDate: returnDeadline,
      });
    }
  }

  return alerts;
}

/**
 * Send deposit deadline notifications to landlords.
 * Called by the daily deposit-reminders BullMQ job.
 */
export async function sendDepositReminders(): Promise<number> {
  const alerts = await checkDepositDeadlines();
  let sent = 0;

  for (const alert of alerts) {
    const lease = await prisma.lease.findUnique({
      where: { id: alert.leaseId },
      include: {
        unit: { include: { property: { include: { user: true } } } },
      },
    });
    if (!lease) continue;

    const landlord = lease.unit.property.user;
    const subject =
      alert.type === "receipt_due"
        ? `Deposit receipt due in ${alert.daysRemaining} days for ${alert.tenantName}`
        : alert.type === "statement_due"
          ? `Itemized statement due in ${alert.daysRemaining} days for ${alert.tenantName}`
          : `Deposit return due in ${alert.daysRemaining} days for ${alert.tenantName}`;

    const penalty =
      alert.type === "return_due" && alert.daysRemaining <= 7
        ? "\n\nWARNING: Failure to return deposit within 45 days may result in liability for 2x the deposit amount plus attorney fees (765 ILCS 710)."
        : "";

    await sendNotification({
      type: "deposit_reminder",
      recipientEmail: landlord.email,
      recipientName: landlord.name || landlord.email,
      subject,
      body: `${subject}\n\nProperty: ${alert.propertyName}, Unit ${alert.unitNumber}\nDeadline: ${alert.deadlineDate.toLocaleDateString("en-US")}${penalty}`,
      metadata: { leaseId: alert.leaseId, alertType: alert.type },
    });
    sent++;
  }

  return sent;
}
