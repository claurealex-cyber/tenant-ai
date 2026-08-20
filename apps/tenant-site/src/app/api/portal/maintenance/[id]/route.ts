import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/portal/maintenance/[id] — detail of a single maintenance request.
 *
 * IDOR check: verifies tenantId matches session tenant.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(tenantAuthOptions);
  if (!session?.tenant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const maintenanceRequest = await prisma.maintenanceRequest.findUnique({
    where: { id },
    select: {
      id: true,
      propertyId: true,
      tenantId: true,
      unitId: true,
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

  if (!maintenanceRequest || maintenanceRequest.tenantId !== session.tenant.id) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  return NextResponse.json({ request: maintenanceRequest });
}
