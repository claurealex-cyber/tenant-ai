import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/maintenance/[id] — get a single maintenance request detail.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const maintenanceRequest = await prisma.maintenanceRequest.findUnique({
    where: { id },
    include: {
      property: { select: { id: true, name: true, userId: true } },
      tenant: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
    },
  });

  if (!maintenanceRequest || maintenanceRequest.property.userId !== session.user.id) {
    return NextResponse.json({ error: "Maintenance request not found" }, { status: 404 });
  }

  // Resolve unit number
  let unitNumber: string | null = null;
  if (maintenanceRequest.unitId) {
    const unit = await prisma.unit.findUnique({
      where: { id: maintenanceRequest.unitId },
      select: { unitNumber: true },
    });
    unitNumber = unit?.unitNumber ?? null;
  }

  return NextResponse.json({
    request: { ...maintenanceRequest, unitNumber },
  });
}

/**
 * PUT /api/maintenance/[id] — update a maintenance request.
 *
 * Body: { status?, notes?, priority? }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const maintenanceRequest = await prisma.maintenanceRequest.findUnique({
      where: { id },
      include: {
        property: { select: { userId: true } },
      },
    });

    if (!maintenanceRequest || maintenanceRequest.property.userId !== session.user.id) {
      return NextResponse.json({ error: "Maintenance request not found" }, { status: 404 });
    }

    const body = await request.json();
    const { status, notes, priority } = body;

    const data: Record<string, unknown> = {};

    if (status !== undefined) {
      const validStatuses = ["open", "in_progress", "completed", "closed"];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: "status must be: open, in_progress, completed, or closed" },
          { status: 400 }
        );
      }
      data.status = status;

      // Set resolvedAt when completing or closing
      if (
        (status === "completed" || status === "closed") &&
        maintenanceRequest.status !== "completed" &&
        maintenanceRequest.status !== "closed"
      ) {
        data.resolvedAt = new Date();
      }

      // Clear resolvedAt if reopening
      if (status === "open" || status === "in_progress") {
        data.resolvedAt = null;
      }
    }

    if (notes !== undefined) {
      data.notes = notes || null;
    }

    if (priority !== undefined) {
      const validPriorities = ["low", "medium", "high", "urgent"];
      if (!validPriorities.includes(priority)) {
        return NextResponse.json(
          { error: "priority must be: low, medium, high, or urgent" },
          { status: 400 }
        );
      }
      data.priority = priority;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const updated = await prisma.maintenanceRequest.update({
      where: { id },
      data,
    });

    return NextResponse.json({ request: updated });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
