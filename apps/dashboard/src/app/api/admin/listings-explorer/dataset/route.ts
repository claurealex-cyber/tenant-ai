import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function admin() { const s = await getServerSession(authOptions); return !!(s?.user && (s.user as any).role === "admin"); }

/** GET the ExplorerListing dataset: propertyTypes(csv), priceMin/Max, beds, neighborhoods(csv), sort, page. */
export async function GET(request: NextRequest) {
  if (!(await admin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sp = new URL(request.url).searchParams;
  const num = (k: string) => { const v = sp.get(k); if (!v) return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; };
  const priceMin = num("priceMin"), priceMax = num("priceMax"), beds = num("beds");
  const types = (sp.get("propertyTypes") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const neighborhoods = (sp.get("neighborhoods") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const q = sp.get("q")?.trim();
  const sort = sp.get("sort") || "price_asc";
  const page = Math.max(1, num("page") || 1);
  const pageSize = Math.min(200, num("pageSize") || 50);

  const where: any = { status: "active" };
  if (priceMin != null || priceMax != null) where.price = { ...(priceMin != null ? { gte: priceMin } : {}), ...(priceMax != null ? { lte: priceMax } : {}) };
  if (beds != null) where.beds = { gte: beds };
  if (types.length) where.propertyType = { in: types };
  if (neighborhoods.length) where.neighborhood = { in: neighborhoods };
  if (q) where.address = { contains: q, mode: "insensitive" };
  const orderBy = sort === "price_desc" ? [{ price: "desc" as const }] : sort === "newest" ? [{ firstSeenAt: "desc" as const }] : [{ price: "asc" as const }];

  const [total, listings] = await Promise.all([
    prisma.explorerListing.count({ where }),
    prisma.explorerListing.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return NextResponse.json({ total, page, pageSize, listings });
}
