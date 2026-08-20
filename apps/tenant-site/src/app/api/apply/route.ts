import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveTenantContext } from "@/lib/tenant-context";
import { Prisma } from "@prisma/client";
import { encrypt, sendEmail, textToHtml } from "@tenant-ai/shared";

/**
 * POST /api/apply — submit a web rental application.
 *
 * Public endpoint — no auth required (CAPTCHA protection in production).
 */
export async function POST(request: NextRequest) {
  try {
    const hostname = request.headers.get("x-tenant-host") || request.headers.get("host") || "";

    const ctx = await resolveTenantContext(hostname);
    if (!ctx) {
      return NextResponse.json({ error: "Website not found" }, { status: 404 });
    }

    const body = await request.json();
    const { turnstileToken, propertyId, token: inviteToken, ...fields } = body;

    // Cloudflare Turnstile CAPTCHA verification (skipped when env var not set)
    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
    if (turnstileSecret) {
      if (!turnstileToken) {
        return NextResponse.json(
          { error: "CAPTCHA verification required" },
          { status: 400 }
        );
      }
      const verifyRes = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: turnstileSecret, response: turnstileToken }),
        }
      );
      const verifyData = await verifyRes.json();
      if (!verifyData.success) {
        return NextResponse.json(
          { error: "CAPTCHA verification failed" },
          { status: 400 }
        );
      }
    }

    if (!propertyId) {
      return NextResponse.json(
        { error: "propertyId is required" },
        { status: 400 }
      );
    }

    // Verify property belongs to this landlord and is active
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
    });

    if (!property || property.userId !== ctx.userId || !property.isActive) {
      return NextResponse.json(
        { error: "Property not found" },
        { status: 404 }
      );
    }

    // If this submission came from an SMS survey link, validate the invite.
    let invite: Awaited<ReturnType<typeof prisma.surveyInvite.findUnique>> = null;
    if (inviteToken) {
      invite = await prisma.surveyInvite.findUnique({ where: { token: inviteToken } });
      if (!invite || invite.propertyId !== propertyId) {
        return NextResponse.json({ error: "Invalid survey link" }, { status: 400 });
      }
      if (invite.usedAt) {
        return NextResponse.json(
          { error: "This survey link has already been used" },
          { status: 410 }
        );
      }
      if (invite.expiresAt < new Date()) {
        return NextResponse.json(
          { error: "This survey link has expired" },
          { status: 410 }
        );
      }
    }

    // Check for duplicate application (same email + property within 30 days)
    if (fields.email) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const existing = await prisma.application.findFirst({
        where: {
          propertyId,
          email: fields.email,
          status: "completed",
          completedAt: { gte: thirtyDaysAgo },
        },
      });

      if (existing) {
        return NextResponse.json(
          { error: "You already have a recent application for this property" },
          { status: 409 }
        );
      }
    }

    // Separate standard fields from custom responses
    const standardFields = [
      "fullName", "dateOfBirth", "ssn", "email", "currentAddress",
      "monthlyIncome", "employer", "employerPhone", "moveInDate",
      "hasPets", "petDetails", "phone", "vehicles",
      "rentalHistory", "references",
    ];
    const standardData: Record<string, unknown> = {};
    const customResponses: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(fields)) {
      if (standardFields.includes(key)) {
        standardData[key] = value;
      } else {
        customResponses[key] = value;
      }
    }

    // Encrypt PII fields before storage
    const encryptedSsn = standardData.ssn
      ? encrypt(standardData.ssn as string)
      : undefined;
    const encryptedDob = standardData.dateOfBirth
      ? encrypt(standardData.dateOfBirth as string)
      : undefined;

    // Parse vehicles string into structured JSON array
    let vehiclesJson: Prisma.InputJsonValue | undefined;
    if (standardData.vehicles && typeof standardData.vehicles === "string") {
      const raw = standardData.vehicles as string;
      // Try to parse "2020 Honda Civic (ABC123)" format
      const match = raw.match(/^(\d{4})\s+(.+?)\s*\(([^)]+)\)$/);
      if (match) {
        vehiclesJson = [{ year: match[1], makeModel: match[2].trim(), licensePlate: match[3].trim() }];
      } else {
        vehiclesJson = [{ description: raw }];
      }
    }

    // Parse rentalHistory and references into structured JSON arrays
    const rentalHistoryJson: Prisma.InputJsonValue | undefined =
      standardData.rentalHistory && typeof standardData.rentalHistory === "string"
        ? [{ description: standardData.rentalHistory as string }]
        : undefined;
    const referencesJson: Prisma.InputJsonValue | undefined =
      standardData.references && typeof standardData.references === "string"
        ? [{ description: standardData.references as string }]
        : undefined;

    // Atomically consume the invite before creating the application so a shared or
    // forwarded link can't be submitted twice, even under concurrent requests.
    if (invite) {
      const claim = await prisma.surveyInvite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claim.count === 0) {
        return NextResponse.json(
          { error: "This survey link has already been used" },
          { status: 410 }
        );
      }
    }

    const application = await prisma.application.create({
      data: {
        propertyId,
        status: "completed",
        channel: inviteToken ? "sms_link" : "web",
        fullName: standardData.fullName as string | undefined,
        dateOfBirth: encryptedDob,
        ssn: encryptedSsn,
        email: standardData.email as string | undefined,
        currentAddress: standardData.currentAddress as string | undefined,
        monthlyIncome: standardData.monthlyIncome as string | undefined,
        employer: standardData.employer as string | undefined,
        employerPhone: standardData.employerPhone as string | undefined,
        moveInDate: standardData.moveInDate as string | undefined,
        hasPets: standardData.hasPets as boolean | undefined,
        petDetails: standardData.petDetails as string | undefined,
        callerPhone: invite?.phone ?? (standardData.phone as string | undefined),
        vehicles: vehiclesJson,
        rentalHistory: rentalHistoryJson,
        references: referencesJson,
        customResponses: Object.keys(customResponses).length > 0
          ? customResponses as Prisma.InputJsonValue
          : undefined,
        completedAt: new Date(),
      },
    });

    // Link the consumed invite to the created application (usedAt was set above).
    if (invite) {
      await prisma.surveyInvite.update({
        where: { id: invite.id },
        data: { applicationId: application.id },
      });
    }

    // Notify landlord (best-effort)
    try {
      const landlord = await prisma.user.findUnique({
        where: { id: property.userId },
        select: { email: true, name: true },
      });
      if (landlord) {
        const applicantName = (standardData.fullName as string) || "An applicant";
        const emailBody = [
          `${applicantName} has submitted a new application for ${property.name} (${property.address}).`,
          "",
          "You can review the application in your dashboard.",
        ].join("\n");
        const emailSubject = `New Application — ${property.name}`;
        await sendEmail({
          to: landlord.email,
          subject: emailSubject,
          html: textToHtml(emailBody, emailSubject),
        });
      }
    } catch {
      // Don't fail the request if notification fails
    }

    return NextResponse.json(
      { applicationId: application.id, status: "completed" },
      { status: 201 }
    );
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
