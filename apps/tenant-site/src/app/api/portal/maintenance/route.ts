import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail, textToHtml } from "@tenant-ai/shared";

/**
 * GET /api/portal/maintenance — list tenant's maintenance requests.
 */
export async function GET() {
  const session = await getServerSession(tenantAuthOptions);
  if (!session?.tenant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requests = await prisma.maintenanceRequest.findMany({
    where: { tenantId: session.tenant.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      priority: true,
      status: true,
      imageUrls: true,
      notes: true,
      resolvedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ requests });
}

/**
 * POST /api/portal/maintenance — create a new maintenance request.
 *
 * Body: { title, description, category?, imageUrls? }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(tenantAuthOptions);
    if (!session?.tenant) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await request.json();
    const { title, description, category, imageUrls } = data;

    if (!title?.trim()) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    if (!description?.trim()) {
      return NextResponse.json(
        { error: "Description is required" },
        { status: 400 }
      );
    }

    // Look up tenant's active lease to get propertyId and unitId
    const lease = await prisma.lease.findFirst({
      where: { tenantId: session.tenant.id, status: "active" },
      include: {
        unit: {
          include: {
            property: { select: { id: true, name: true, address: true, userId: true } },
          },
        },
      },
    });

    if (!lease) {
      return NextResponse.json(
        { error: "No active lease found. You must have an active lease to submit a maintenance request." },
        { status: 400 }
      );
    }

    const validCategories = ["plumbing", "electrical", "appliance", "hvac", "pest", "general", "other"];
    const safeCategory = category && validCategories.includes(category) ? category : "general";

    const maintenanceRequest = await prisma.maintenanceRequest.create({
      data: {
        propertyId: lease.unit.property.id,
        tenantId: session.tenant.id,
        unitId: lease.unitId,
        title: title.trim(),
        description: description.trim(),
        category: safeCategory,
        imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
      },
    });

    // Notify landlord (best-effort)
    try {
      const landlord = await prisma.user.findUnique({
        where: { id: lease.unit.property.userId },
        select: { email: true, name: true },
      });

      if (landlord) {
        const tenantName = `${session.tenant.firstName} ${session.tenant.lastName}`;
        const emailBody = [
          `${tenantName} has submitted a new maintenance request for ${lease.unit.property.name} (${lease.unit.property.address}).`,
          "",
          `Title: ${title.trim()}`,
          `Category: ${safeCategory}`,
          "",
          `Description: ${description.trim()}`,
          "",
          "You can review and manage this request in your dashboard.",
        ].join("\n");
        const emailSubject = `New Maintenance Request — ${lease.unit.property.name}`;
        await sendEmail({
          to: landlord.email,
          subject: emailSubject,
          html: textToHtml(emailBody, emailSubject),
        });
      }
    } catch {
      // Don't fail the request if notification fails
    }

    return NextResponse.json({ request: maintenanceRequest }, { status: 201 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
