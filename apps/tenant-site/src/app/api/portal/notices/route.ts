import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/portal/notices — notices visible to tenant.
 */
export async function GET() {
  const session = await getServerSession(tenantAuthOptions);
  if (!session?.tenant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const notices = await prisma.notice.findMany({
    where: {
      tenantId: session.tenant.id,
      visibleInPortal: true,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      reason: true,
      amountOwed: true,
      content: true,
      serviceMethod: true,
      serviceDate: true,
      effectiveDate: true,
      expirationDate: true,
      pdfUrl: true,
      createdAt: true,
    },
  });

  const noticesWithPdf = notices.map((n) => ({
    ...n,
    pdfUrl: `/api/portal/notices/${n.id}/pdf`,
  }));

  return NextResponse.json({ notices: noticesWithPdf });
}
