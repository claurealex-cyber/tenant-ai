import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function admin() {
  const s = await getServerSession(authOptions);
  return s?.user && (s.user as any).role === "admin" ? (s.user as any).id ?? "admin" : null;
}

/** GET -> all saved searches (+ match counts). */
export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const searches = await prisma.buyerSearch.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { listings: true } } },
  });
  return NextResponse.json({ searches });
}

/** POST { label, notifyPhone, priceMax, priceMin, beds, zips[], centerLat, centerLng, radiusMi } -> create. */
export async function POST(request: NextRequest) {
  if (!(await admin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  if (!b.label || !b.notifyPhone) return NextResponse.json({ error: "label and notifyPhone required" }, { status: 400 });
  const search = await prisma.buyerSearch.create({
    data: {
      label: String(b.label).slice(0, 120),
      notifyPhone: String(b.notifyPhone),
      priceMax: b.priceMax != null ? Number(b.priceMax) : null,
      priceMin: b.priceMin != null ? Number(b.priceMin) : null,
      beds: b.beds != null ? Number(b.beds) : null,
      zips: Array.isArray(b.zips) ? b.zips.map(String) : [],
      centerLat: b.centerLat != null ? Number(b.centerLat) : null,
      centerLng: b.centerLng != null ? Number(b.centerLng) : null,
      radiusMi: b.radiusMi != null ? Number(b.radiusMi) : null,
      keywords: b.keywords ? String(b.keywords) : null,
      enabled: b.enabled !== false,
      alertsArmed: b.alertsArmed === true,
      provider: b.provider === "fixture" ? "fixture" : "search",
    },
  });
  return NextResponse.json({ ok: true, search });
}
