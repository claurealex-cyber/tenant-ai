import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function admin() {
  const s = await getServerSession(authOptions);
  return !!(s?.user && (s.user as any).role === "admin");
}

/** GET ?searchId=&status= -> the listing dataset for a search. */
export async function GET(request: NextRequest) {
  if (!(await admin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(request.url);
  const searchId = url.searchParams.get("searchId") || undefined;
  const status = url.searchParams.get("status") || undefined;
  const listings = await prisma.buyerListing.findMany({
    where: { ...(searchId ? { searchId } : {}), ...(status ? { status } : {}) },
    orderBy: [{ firstSeenAt: "desc" }],
    take: 300,
  });
  return NextResponse.json({ listings });
}
