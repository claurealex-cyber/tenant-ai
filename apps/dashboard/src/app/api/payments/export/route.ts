import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toCSV } from "@tenant-ai/shared";

/**
 * GET /api/payments/export — download payments as CSV.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payments = await prisma.payment.findMany({
    where: {
      lease: { unit: { property: { userId: session.user.id } } },
    },
    include: {
      tenant: { select: { firstName: true, lastName: true } },
      lease: {
        include: {
          unit: {
            include: {
              property: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10000,
  });

  const rows = payments.map((p) => ({
    date: (p.paidAt || p.createdAt).toISOString(),
    tenant: `${p.tenant.firstName} ${p.tenant.lastName}`,
    property: p.lease.unit.property.name,
    unit: p.lease.unit.unitNumber,
    amount: (p.amount / 100).toFixed(2),
    type: p.type,
    method: p.method,
    status: p.status,
  }));

  const columns = [
    { key: "date", label: "Date" },
    { key: "tenant", label: "Tenant" },
    { key: "property", label: "Property" },
    { key: "unit", label: "Unit" },
    { key: "amount", label: "Amount ($)" },
    { key: "type", label: "Type" },
    { key: "method", label: "Method" },
    { key: "status", label: "Status" },
  ];

  const csv = toCSV(rows, columns);
  const today = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="payments-${today}.csv"`,
    },
  });
}
