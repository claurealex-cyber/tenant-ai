import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { sendEmail, textToHtml, logAudit } from "@tenant-ai/shared";

/**
 * POST /api/tenants/[id]/convert — convert an application to a tenant account.
 *
 * Body: { applicationId }
 *
 * Creates a Tenant record from application data + sends an invite.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: applicationId } = await params;

    // Parse optional lease params from body (backward compatible — empty body OK)
    let leaseParams: Record<string, unknown> = {};
    try {
      leaseParams = await request.json();
    } catch {
      // Empty body — no lease params
    }

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        property: { include: { user: { select: { name: true } } } },
      },
    });

    if (!application || application.property.userId !== session.user.id) {
      return NextResponse.json(
        { error: "Application not found" },
        { status: 404 }
      );
    }

    if (application.status !== "reviewed" && application.status !== "completed") {
      return NextResponse.json(
        { error: "Only reviewed or completed applications can be converted" },
        { status: 400 }
      );
    }

    if (!application.email) {
      return NextResponse.json(
        { error: "Application must have an email to create a tenant account" },
        { status: 400 }
      );
    }

    // Check if tenant already exists for this email + landlord
    const existingTenant = await prisma.tenant.findFirst({
      where: {
        email: application.email,
        userId: session.user.id,
      },
    });

    if (existingTenant) {
      return NextResponse.json(
        { error: "A tenant account already exists for this email", tenantId: existingTenant.id },
        { status: 409 }
      );
    }

    // Generate temporary password
    const tempPassword = crypto.randomBytes(12).toString("base64url");
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    // Parse name
    const fullName = application.fullName || "Unknown";
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0] || "Unknown";
    const lastName = nameParts.slice(1).join(" ") || "Tenant";

    // Create tenant
    const tenant = await prisma.tenant.create({
      data: {
        email: application.email,
        passwordHash,
        firstName,
        lastName,
        phone: application.callerPhone || null,
        userId: session.user.id,
      },
    });

    // Create invite token
    const invite = await prisma.tenantInvite.create({
      data: {
        token: crypto.randomBytes(32).toString("hex"),
        email: application.email,
        userId: session.user.id,
        propertyId: application.propertyId,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72h
      },
    });

    // Send invite email
    try {
      const tenantSiteUrl = process.env.TENANT_SITE_URL || "http://localhost:3002";
      const signupUrl = `${tenantSiteUrl}/signup?token=${invite.token}&email=${encodeURIComponent(application.email)}`;
      const landlordName = application.property.user?.name || "Your landlord";
      const emailBody = [
        `Hello ${firstName},`,
        "",
        `${landlordName} has invited you to join the tenant portal for ${application.property.name}.`,
        "",
        `Click the link below to set up your account:`,
        signupUrl,
        "",
        "This invite link expires in 72 hours.",
      ].join("\n");
      const emailSubject = `You're invited to the tenant portal — ${application.property.name}`;
      await sendEmail({
        to: application.email,
        subject: emailSubject,
        html: textToHtml(emailBody, emailSubject),
      });
    } catch {
      // Don't fail the request if email fails
    }

    // Optional: create lease if unitId + monthlyRent + startDate provided
    let lease = null;
    const { unitId, monthlyRent, startDate, endDate, leaseType, securityDeposit, lateFeeAmount, rentDueDay } = leaseParams as Record<string, any>;

    if (unitId && monthlyRent && startDate) {
      // Verify unit belongs to this landlord
      const unit = await prisma.unit.findUnique({
        where: { id: unitId },
        include: { property: { select: { userId: true, cookCounty: true } } },
      });

      if (!unit || unit.property.userId !== session.user.id) {
        return NextResponse.json({ error: "Unit not found" }, { status: 404 });
      }

      // Check unit doesn't have active lease
      const activeLease = await prisma.lease.findFirst({
        where: { unitId, status: "active" },
      });
      if (activeLease) {
        return NextResponse.json(
          { error: "Unit already has an active lease" },
          { status: 400 }
        );
      }

      const IL_MIN_GRACE_DAYS = 5;
      const graceDays = Math.max(IL_MIN_GRACE_DAYS, 5);

      // Cook County validations
      if (unit.property.cookCounty && securityDeposit) {
        const maxDeposit = Math.round(monthlyRent * 1.5);
        if (securityDeposit > maxDeposit) {
          return NextResponse.json(
            { error: `Security deposit cannot exceed 1.5x monthly rent for Cook County` },
            { status: 400 }
          );
        }
      }

      if (unit.property.cookCounty && lateFeeAmount) {
        const { getCookCountyLateFeeMax } = await import("@tenant-ai/shared");
        const maxLateFee = getCookCountyLateFeeMax(monthlyRent);
        if (lateFeeAmount > maxLateFee) {
          return NextResponse.json(
            { error: `Late fee exceeds Cook County maximum` },
            { status: 400 }
          );
        }
      }

      const start = new Date(startDate);
      const end = endDate ? new Date(endDate) : null;

      lease = await prisma.lease.create({
        data: {
          unitId,
          tenantId: tenant.id,
          monthlyRent,
          securityDeposit: securityDeposit || null,
          startDate: start,
          endDate: end,
          leaseType: leaseType || (end ? "fixed" : "month_to_month"),
          lateFeeAmount: lateFeeAmount || null,
          lateFeeGraceDays: graceDays,
          rentDueDay: rentDueDay || 1,
        },
      });

      await prisma.unit.update({
        where: { id: unitId },
        data: { status: "occupied" },
      });

      await logAudit(prisma, {
        userId: session.user.id,
        action: "create_lease",
        resourceType: "Lease",
        resourceId: lease.id,
        metadata: { unitId, tenantId: tenant.id, monthlyRent, viaConvert: true } as any,
      });
    }

    return NextResponse.json(
      {
        tenant: {
          id: tenant.id,
          email: tenant.email,
          firstName: tenant.firstName,
          lastName: tenant.lastName,
        },
        inviteToken: invite.token,
        ...(lease ? { lease: { id: lease.id, unitId: lease.unitId, monthlyRent: lease.monthlyRent } } : {}),
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
