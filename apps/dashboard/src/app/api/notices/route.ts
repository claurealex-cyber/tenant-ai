import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NOTICE_PERIODS, logAudit, sendEmail, buildNoticeGeneratedEmail } from "@tenant-ai/shared";
import { sendNoticeSms } from "@/lib/notice-sms";

/**
 * GET /api/notices — list notices for the authenticated landlord.
 *
 * Query params: type, tenantId, leaseId
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = request.nextUrl.searchParams;
    const type = params.get("type");
    const tenantId = params.get("tenantId");
    const leaseId = params.get("leaseId");

    const where: Record<string, unknown> = {
      lease: {
        unit: {
          property: { userId: session.user.id },
        },
      },
    };

    if (type) where.type = type;
    if (tenantId) where.tenantId = tenantId;
    if (leaseId) where.leaseId = leaseId;

    const notices = await prisma.notice.findMany({
      where,
      include: {
        tenant: { select: { firstName: true, lastName: true, email: true } },
        lease: {
          include: {
            unit: {
              include: {
                property: { select: { id: true, name: true, address: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const noticesWithPdf = notices.map((n) => ({
      ...n,
      pdfUrl: `/api/notices/${n.id}/pdf`,
    }));

    return NextResponse.json({ notices: noticesWithPdf });
  } catch (err) {
    console.error("[notices] GET error:", err);
    return NextResponse.json({ error: "Failed to load notices" }, { status: 500 });
  }
}

/**
 * POST /api/notices — generate a new notice.
 *
 * Body: { type, leaseId, tenantId, amountOwed?, violationDescription?, effectiveDate? }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { type, leaseId, tenantId } = body;

    if (!type || !leaseId || !tenantId) {
      return NextResponse.json(
        { error: "type, leaseId, and tenantId are required" },
        { status: 400 }
      );
    }

    // Verify ownership
    const lease = await prisma.lease.findUnique({
      where: { id: leaseId },
      include: {
        tenant: true,
        unit: {
          include: {
            property: { include: { user: true } },
          },
        },
      },
    });

    if (!lease || lease.unit.property.userId !== session.user.id) {
      return NextResponse.json({ error: "Lease not found" }, { status: 404 });
    }

    try {
      if (type === "five_day") {
        return await handleFiveDayNotice(lease, tenantId, body.amountOwed, body.content);
      } else if (type === "ten_day") {
        return await handleTenDayNotice(
          lease,
          tenantId,
          body.violationDescription,
          body.content
        );
      } else if (type === "thirty_day") {
        return await handleThirtyDayNotice(
          lease,
          tenantId,
          body.effectiveDate,
          body.content
        );
      } else {
        return NextResponse.json(
          { error: "Invalid notice type. Use: five_day, ten_day, thirty_day" },
          { status: 400 }
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleFiveDayNotice(lease: any, tenantId: string, amountOwed?: number, customContent?: string) {
  // Calculate amount owed if not provided
  if (amountOwed === undefined) {
    const charges = await prisma.rentCharge.findMany({
      where: {
        leaseId: lease.id,
        status: { in: ["unpaid", "partial"] },
      },
    });
    amountOwed = charges.reduce(
      (sum: number, c: { amount: number; paidAmount: number }) => sum + (c.amount - c.paidAmount),
      0
    );
  }

  // Validate: must have overdue rent
  const overdueCharge = await prisma.rentCharge.findFirst({
    where: {
      leaseId: lease.id,
      status: { in: ["unpaid", "partial"] },
      dueDate: { lt: new Date() },
    },
  });
  if (!overdueCharge) {
    return NextResponse.json(
      { error: "Cannot generate 5-day notice: no rent is currently past due" },
      { status: 400 }
    );
  }

  const tenant = lease.tenant;
  const property = lease.unit.property;
  const landlord = property.user;
  const tenantName = `${tenant.firstName} ${tenant.lastName}`;
  const fmtAmount = `$${(amountOwed / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const templateContent = [
    "FIVE-DAY NOTICE",
    "DEMAND FOR PAYMENT OF RENT",
    "(Pursuant to 735 ILCS 5/9-209)",
    "",
    `TO: ${tenantName}`,
    `    ${property.address}, Unit ${lease.unit.unitNumber}`,
    "",
    `You are hereby notified that there is now due and unpaid rent in the amount of ${fmtAmount} for the premises located at:`,
    "",
    `    ${property.address}, Unit ${lease.unit.unitNumber}`,
    "",
    `You are further notified that payment in full of the above amount is demanded within FIVE (5) days of the service of this notice, and that unless payment is made within that time, your lease of said premises will be terminated.`,
    "",
    `Only full payment of the amount stated above will waive the landlord's right to terminate the lease under this notice. Acceptance of partial payment does not waive the landlord's right to terminate the lease.`,
    "",
    `Date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    "",
    `Landlord/Agent:`,
    `${landlord.name || landlord.companyName || "Property Owner"}`,
    `${landlord.email}`,
  ].join("\n");

  const notice = await prisma.notice.create({
    data: {
      leaseId: lease.id,
      tenantId,
      type: "five_day",
      reason: "non_payment",
      amountOwed,
      content: customContent || templateContent,
      visibleInPortal: true,
    },
  });

  await logAudit(prisma, {
    userId: lease.unit.property.userId,
    action: "create_notice",
    resourceType: "Notice",
    resourceId: notice.id,
    metadata: { type: "five_day", tenantId, amountOwed } as any,
  });

  // Fire-and-forget SMS + email
  sendNoticeSms(notice.id).catch((err) => console.error("[notice] SMS error:", err));
  fireNoticeEmail(tenant, tenantName, "5-Day", property.name, lease.unit.unitNumber);

  return NextResponse.json({ notice }, { status: 201 });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleTenDayNotice(lease: any, tenantId: string, violationDescription?: string, customContent?: string) {
  if (!violationDescription?.trim()) {
    return NextResponse.json(
      { error: "violationDescription is required for 10-day notice" },
      { status: 400 }
    );
  }

  const tenant = lease.tenant;
  const property = lease.unit.property;
  const landlord = property.user;
  const tenantName = `${tenant.firstName} ${tenant.lastName}`;

  const templateContent = [
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
    `    ${violationDescription}`,
    "",
    `You are further notified that your tenancy is terminated effective TEN (10) days from the date of service of this notice.`,
    "",
    `Date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    "",
    `Landlord/Agent:`,
    `${landlord.name || landlord.companyName || "Property Owner"}`,
    `${landlord.email}`,
  ].join("\n");

  const notice = await prisma.notice.create({
    data: {
      leaseId: lease.id,
      tenantId,
      type: "ten_day",
      reason: "lease_violation",
      content: customContent || templateContent,
      visibleInPortal: true,
    },
  });

  await logAudit(prisma, {
    userId: lease.unit.property.userId,
    action: "create_notice",
    resourceType: "Notice",
    resourceId: notice.id,
    metadata: { type: "ten_day", tenantId } as any,
  });

  // Fire-and-forget SMS + email
  sendNoticeSms(notice.id).catch((err) => console.error("[notice] SMS error:", err));
  fireNoticeEmail(tenant, tenantName, "10-Day", property.name, lease.unit.unitNumber);

  return NextResponse.json({ notice }, { status: 201 });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleThirtyDayNotice(lease: any, tenantId: string, effectiveDateStr?: string, customContent?: string) {
  if (!effectiveDateStr) {
    return NextResponse.json(
      { error: "effectiveDate is required for 30-day notice" },
      { status: 400 }
    );
  }

  const effectiveDate = new Date(effectiveDateStr);
  const minDate = new Date();
  minDate.setDate(minDate.getDate() + NOTICE_PERIODS.thirty_day);

  if (effectiveDate < minDate) {
    return NextResponse.json(
      { error: "Effective date must be at least 30 days from today" },
      { status: 400 }
    );
  }

  const tenant = lease.tenant;
  const property = lease.unit.property;
  const landlord = property.user;
  const tenantName = `${tenant.firstName} ${tenant.lastName}`;
  const fmtDate = effectiveDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const templateContent = [
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
    `is terminated effective ${fmtDate}. You are required to vacate and deliver possession of the premises on or before said date.`,
    "",
    `Date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    "",
    `Landlord/Agent:`,
    `${landlord.name || landlord.companyName || "Property Owner"}`,
    `${landlord.email}`,
  ].join("\n");

  const notice = await prisma.notice.create({
    data: {
      leaseId: lease.id,
      tenantId,
      type: "thirty_day",
      reason: "termination",
      effectiveDate,
      content: customContent || templateContent,
      visibleInPortal: true,
    },
  });

  await logAudit(prisma, {
    userId: lease.unit.property.userId,
    action: "create_notice",
    resourceType: "Notice",
    resourceId: notice.id,
    metadata: { type: "thirty_day", tenantId, effectiveDate: effectiveDateStr } as any,
  });

  // Fire-and-forget SMS + email
  sendNoticeSms(notice.id).catch((err) => console.error("[notice] SMS error:", err));
  fireNoticeEmail(tenant, tenantName, "30-Day", property.name, lease.unit.unitNumber);

  return NextResponse.json({ notice }, { status: 201 });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fireNoticeEmail(tenant: any, tenantName: string, noticeType: string, propertyName: string, unitNumber: string) {
  try {
    if (tenant?.email) {
      const html = buildNoticeGeneratedEmail({
        recipientName: tenantName,
        noticeType,
        propertyName,
        unitNumber,
        tenantName,
        isLandlord: false,
      });
      sendEmail({ to: tenant.email, subject: `Notice Issued - ${propertyName}`, html }).catch(() => {});
    }
  } catch { /* never block creation */ }
}
