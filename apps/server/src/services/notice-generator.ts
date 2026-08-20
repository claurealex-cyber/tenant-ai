/**
 * Illinois legal notice generator.
 *
 * Generates 5-day, 10-day, and 30-day notices with IL-required content.
 *
 * References:
 *  - 5-Day: 735 ILCS 5/9-209 (non-payment of rent)
 *  - 10-Day: 735 ILCS 5/9-210 (lease violation)
 *  - 30-Day: 735 ILCS 5/9-207 (termination of month-to-month)
 */

import { prisma } from "../lib/prisma.js";
import { NOTICE_PERIODS } from "@tenant-ai/shared";
import { sendNotification } from "./notifications.js";

// ── Types ──

export type NoticeType = "five_day" | "ten_day" | "thirty_day";

export interface FiveDayNoticeInput {
  leaseId: string;
  tenantId: string;
  amountOwed?: number; // cents — auto-calculated if not provided
}

export interface TenDayNoticeInput {
  leaseId: string;
  tenantId: string;
  violationDescription: string;
}

export interface ThirtyDayNoticeInput {
  leaseId: string;
  tenantId: string;
  effectiveDate: Date;
}

export interface NoticeResult {
  id: string;
  type: NoticeType;
  content: string;
}

// ── Helpers ──

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ── 5-Day Notice (Non-Payment of Rent) — 735 ILCS 5/9-209 ──

export async function generateFiveDayNotice(
  input: FiveDayNoticeInput
): Promise<NoticeResult> {
  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    include: {
      tenant: true,
      unit: {
        include: {
          property: { include: { user: true } },
        },
      },
    },
  });

  if (!lease) throw new Error("Lease not found");

  // Calculate amount owed from outstanding RentCharges if not provided
  let amountOwed = input.amountOwed;
  if (amountOwed === undefined) {
    const charges = await prisma.rentCharge.findMany({
      where: {
        leaseId: input.leaseId,
        status: { in: ["unpaid", "partial"] },
      },
    });
    amountOwed = charges.reduce(
      (sum, c) => sum + (c.amount - c.paidAmount),
      0
    );
  }

  // Validate: rent must be past due
  const overdueCharges = await prisma.rentCharge.findFirst({
    where: {
      leaseId: input.leaseId,
      status: { in: ["unpaid", "partial"] },
      dueDate: { lt: new Date() },
    },
  });
  if (!overdueCharges) {
    throw new Error(
      "Cannot generate 5-day notice: no rent is currently past due"
    );
  }

  const tenant = lease.tenant;
  const property = lease.unit.property;
  const landlord = property.user;
  const tenantName = `${tenant.firstName} ${tenant.lastName}`;

  const content = [
    "FIVE-DAY NOTICE",
    "DEMAND FOR PAYMENT OF RENT",
    "(Pursuant to 735 ILCS 5/9-209)",
    "",
    `TO: ${tenantName}`,
    `    ${property.address}, Unit ${lease.unit.unitNumber}`,
    "",
    `You are hereby notified that there is now due and unpaid rent in the amount of ${formatCents(amountOwed)} for the premises located at:`,
    "",
    `    ${property.address}, Unit ${lease.unit.unitNumber}`,
    "",
    `You are further notified that payment in full of the above amount is demanded within FIVE (5) days of the service of this notice, and that unless payment is made within that time, your lease of said premises will be terminated.`,
    "",
    `Only full payment of the amount stated above will waive the landlord's right to terminate the lease under this notice. Acceptance of partial payment does not waive the landlord's right to terminate the lease.`,
    "",
    `Date: ${formatDate(new Date())}`,
    "",
    `Landlord/Agent:`,
    `${landlord.name || landlord.companyName || "Property Owner"}`,
    `${landlord.email}`,
    landlord.phone ? `${landlord.phone}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const notice = await prisma.notice.create({
    data: {
      leaseId: input.leaseId,
      tenantId: input.tenantId,
      type: "five_day",
      reason: "non_payment",
      amountOwed,
      content,
      visibleInPortal: true,
    },
  });

  // Notify landlord (best-effort)
  try {
    await sendNotification({
      type: "notice_generated",
      recipientEmail: landlord.email,
      recipientName: landlord.name || landlord.email,
      subject: `5-day notice generated for ${tenantName}`,
      body: `A 5-day notice has been generated for ${tenantName} at ${property.name}, Unit ${lease.unit.unitNumber}.\n\nYou can download the notice from your dashboard.`,
      metadata: { noticeId: notice.id, leaseId: lease.id },
    });
  } catch (notifyErr) {
    console.error("[notice-generator] Notification error:", notifyErr);
  }

  return { id: notice.id, type: "five_day", content };
}

// ── 10-Day Notice (Lease Violation) — 735 ILCS 5/9-210 ──

export async function generateTenDayNotice(
  input: TenDayNoticeInput
): Promise<NoticeResult> {
  if (!input.violationDescription.trim()) {
    throw new Error("Violation description is required for 10-day notice");
  }

  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    include: {
      tenant: true,
      unit: {
        include: {
          property: { include: { user: true } },
        },
      },
    },
  });

  if (!lease) throw new Error("Lease not found");

  const tenant = lease.tenant;
  const property = lease.unit.property;
  const landlord = property.user;
  const tenantName = `${tenant.firstName} ${tenant.lastName}`;

  const content = [
    "TEN-DAY NOTICE",
    "NOTICE TO QUIT FOR LEASE VIOLATION",
    "(Pursuant to 735 ILCS 5/9-210)",
    "",
    `TO: ${tenantName}`,
    `    ${property.address}, Unit ${lease.unit.unitNumber}`,
    "",
    `You are hereby notified that you are in violation of the terms of your lease for the premises located at:`,
    "",
    `    ${property.address}, Unit ${lease.unit.unitNumber}`,
    "",
    `The specific violation is as follows:`,
    "",
    `    ${input.violationDescription}`,
    "",
    `You are further notified that your tenancy is terminated effective TEN (10) days from the date of service of this notice. You are required to deliver possession of the premises to the landlord on or before the expiration of said ten-day period.`,
    "",
    `Date: ${formatDate(new Date())}`,
    "",
    `Landlord/Agent:`,
    `${landlord.name || landlord.companyName || "Property Owner"}`,
    `${landlord.email}`,
    landlord.phone ? `${landlord.phone}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const notice = await prisma.notice.create({
    data: {
      leaseId: input.leaseId,
      tenantId: input.tenantId,
      type: "ten_day",
      reason: "lease_violation",
      content,
      visibleInPortal: true,
    },
  });

  // Notify landlord (best-effort)
  try {
    await sendNotification({
      type: "notice_generated",
      recipientEmail: landlord.email,
      recipientName: landlord.name || landlord.email,
      subject: `10-day notice generated for ${tenantName}`,
      body: `A 10-day notice has been generated for ${tenantName} at ${property.name}, Unit ${lease.unit.unitNumber}.\n\nYou can download the notice from your dashboard.`,
      metadata: { noticeId: notice.id, leaseId: lease.id },
    });
  } catch (notifyErr) {
    console.error("[notice-generator] Notification error:", notifyErr);
  }

  return { id: notice.id, type: "ten_day", content };
}

// ── 30-Day Notice (Termination of Month-to-Month) — 735 ILCS 5/9-207 ──

export async function generateThirtyDayNotice(
  input: ThirtyDayNoticeInput
): Promise<NoticeResult> {
  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    include: {
      tenant: true,
      unit: {
        include: {
          property: { include: { user: true } },
        },
      },
    },
  });

  if (!lease) throw new Error("Lease not found");

  // Validate: effective date must be at least 30 days from now
  const now = new Date();
  const minEffective = new Date(now);
  minEffective.setDate(minEffective.getDate() + NOTICE_PERIODS.thirty_day);

  if (input.effectiveDate < minEffective) {
    throw new Error(
      "Effective date must be at least 30 days from today"
    );
  }

  const tenant = lease.tenant;
  const property = lease.unit.property;
  const landlord = property.user;
  const tenantName = `${tenant.firstName} ${tenant.lastName}`;

  const content = [
    "THIRTY-DAY NOTICE",
    "NOTICE OF TERMINATION OF TENANCY",
    "(Pursuant to 735 ILCS 5/9-207)",
    "",
    `TO: ${tenantName}`,
    `    ${property.address}, Unit ${lease.unit.unitNumber}`,
    "",
    `You are hereby notified that your month-to-month tenancy for the premises located at:`,
    "",
    `    ${property.address}, Unit ${lease.unit.unitNumber}`,
    "",
    `is terminated effective ${formatDate(input.effectiveDate)}. You are required to vacate and deliver possession of the premises on or before said date.`,
    "",
    `Date: ${formatDate(new Date())}`,
    "",
    `Landlord/Agent:`,
    `${landlord.name || landlord.companyName || "Property Owner"}`,
    `${landlord.email}`,
    landlord.phone ? `${landlord.phone}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const notice = await prisma.notice.create({
    data: {
      leaseId: input.leaseId,
      tenantId: input.tenantId,
      type: "thirty_day",
      reason: "termination",
      effectiveDate: input.effectiveDate,
      content,
      visibleInPortal: true,
    },
  });

  // Notify landlord (best-effort)
  try {
    await sendNotification({
      type: "notice_generated",
      recipientEmail: landlord.email,
      recipientName: landlord.name || landlord.email,
      subject: `30-day notice generated for ${tenantName}`,
      body: `A 30-day notice has been generated for ${tenantName} at ${property.name}, Unit ${lease.unit.unitNumber}.\n\nYou can download the notice from your dashboard.`,
      metadata: { noticeId: notice.id, leaseId: lease.id },
    });
  } catch (notifyErr) {
    console.error("[notice-generator] Notification error:", notifyErr);
  }

  return { id: notice.id, type: "thirty_day", content };
}

// ── Service Tracking ──

export interface ServiceInput {
  noticeId: string;
  serviceMethod: "personal" | "substitute" | "certified_mail";
  serviceDate: Date;
  servedBy: string;
  certifiedMailTracking?: string;
  serviceProofUrl?: string;
}

/**
 * Record service of a notice and auto-calculate effective/expiration dates.
 */
export async function recordNoticeService(
  input: ServiceInput
): Promise<{ effectiveDate: Date; expirationDate: Date }> {
  if (
    input.serviceMethod === "certified_mail" &&
    !input.certifiedMailTracking
  ) {
    throw new Error(
      "Certified mail tracking number is required for certified mail service"
    );
  }

  const notice = await prisma.notice.findUnique({
    where: { id: input.noticeId },
  });

  if (!notice) throw new Error("Notice not found");

  // Effective date:
  //  - Personal/substitute: same as service date
  //  - Certified mail: service date + 5 days (estimated delivery)
  const effectiveDate = new Date(input.serviceDate);
  if (input.serviceMethod === "certified_mail") {
    effectiveDate.setDate(effectiveDate.getDate() + 5);
  }

  // Expiration date: effective + notice period
  const period =
    NOTICE_PERIODS[notice.type as keyof typeof NOTICE_PERIODS] ?? 5;
  const expirationDate = new Date(effectiveDate);
  expirationDate.setDate(expirationDate.getDate() + period);

  await prisma.notice.update({
    where: { id: input.noticeId },
    data: {
      serviceMethod: input.serviceMethod,
      serviceDate: input.serviceDate,
      servedBy: input.servedBy,
      certifiedMailTracking: input.certifiedMailTracking ?? null,
      serviceProofUrl: input.serviceProofUrl ?? null,
      serviceConfirmed: true,
      effectiveDate,
      expirationDate,
    },
  });

  return { effectiveDate, expirationDate };
}

// ── Notice PDF Generation ──

export async function generateNoticePdf(
  noticeId: string
): Promise<Buffer> {
  // Dynamic import for pdfkit
  const PDFDocument = (await import("pdfkit")).default;

  const notice = await prisma.notice.findUnique({
    where: { id: noticeId },
    include: {
      tenant: true,
      lease: {
        include: {
          unit: { include: { property: true } },
        },
      },
    },
  });

  if (!notice) throw new Error("Notice not found");

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Render full content faithfully — no skipping lines
    const lines = (notice.content || "").split("\n");
    doc.fontSize(11).font("Helvetica");
    for (const line of lines) {
      if (line.trim() === "") {
        doc.moveDown(0.5);
      } else {
        doc.text(line);
      }
    }

    // Footer
    doc.moveDown(2);
    doc
      .fontSize(8)
      .font("Helvetica-Oblique")
      .text(
        "This notice is provided as a legal document. It must be physically served to the tenant in accordance with Illinois law. Electronic delivery alone does not constitute valid service.",
        { align: "center" }
      );

    doc.end();
  });
}
