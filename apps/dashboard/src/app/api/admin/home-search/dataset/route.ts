import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function admin() {
  const s = await getServerSession(authOptions);
  return !!(s?.user && (s.user as any).role === "admin");
}

/**
 * GET the compiled Chicago dataset with filters:
 *   priceMin, priceMax, beds, status, neighborhoods (csv), q (address contains),
 *   sort (price_asc|price_desc|newest), page, pageSize.
 */
export async function GET(request: NextRequest) {
  if (!(await admin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sp = new URL(request.url).searchParams;
  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : undefined);
  const priceMin = num("priceMin");
  const priceMax = num("priceMax");
  const beds = num("beds");
  const status = sp.get("status") || undefined;
  const neighborhoods = (sp.get("neighborhoods") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const q = sp.get("q")?.trim();
  const sort = sp.get("sort") || "price_asc";
  const page = Math.max(1, num("page") || 1);
  const pageSize = Math.min(200, num("pageSize") || 50);

  const where: any = {};
  if (priceMin != null || priceMax != null) where.price = { ...(priceMin != null ? { gte: priceMin } : {}), ...(priceMax != null ? { lte: priceMax } : {}) };
  if (beds != null) where.beds = { gte: beds };
  if (status) where.status = status;
  else where.status = "active";
  if (neighborhoods.length) where.neighborhood = { in: neighborhoods };
  if (q) where.address = { contains: q, mode: "insensitive" };

  const orderBy =
    sort === "price_desc" ? [{ price: "desc" as const }] :
    sort === "newest" ? [{ firstSeenAt: "desc" as const }] :
    [{ price: "asc" as const }];

  const [total, listings] = await Promise.all([
    prisma.chicagoListing.count({ where }),
    prisma.chicagoListing.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return NextResponse.json({ total, page, pageSize, listings });
}
