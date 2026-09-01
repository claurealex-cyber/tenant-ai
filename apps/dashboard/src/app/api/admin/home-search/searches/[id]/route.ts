import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function admin() {
  const s = await getServerSession(authOptions);
  return s?.user && (s.user as any).role === "admin" ? (s.user as any).id ?? "admin" : null;
}

/** PATCH -> update controls (enabled, alertsArmed, label, price, beds, zips, notifyPhone). */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await admin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const b = await request.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  for (const k of ["label", "notifyPhone", "keywords"]) if (typeof b[k] === "string") data[k] = b[k];
  for (const k of ["enabled", "alertsArmed"]) if (typeof b[k] === "boolean") data[k] = b[k];
  for (const k of ["priceMax", "priceMin", "beds", "centerLat", "centerLng", "radiusMi"])
    if (b[k] !== undefined) data[k] = b[k] === null ? null : Number(b[k]);
  if (Array.isArray(b.zips)) data.zips = b.zips.map(String);
  const search = await prisma.buyerSearch.update({ where: { id }, data });
  return NextResponse.json({ ok: true, search });
}

/** DELETE -> remove a saved search (cascades its listings). */
export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await admin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  await prisma.buyerSearch.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
