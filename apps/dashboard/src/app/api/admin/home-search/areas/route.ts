import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// Chicago neighborhoods (WP cluster first) — the location-filter options. Mirrors
// the server's chicago-areas reference; kept here so the tab needs no extra hop.
const WP = ["Wicker Park", "Bucktown", "Ukrainian Village", "East Village", "West Town", "Noble Square", "Logan Square", "Humboldt Park", "Avondale"];
const REST = ["Albany Park", "Andersonville", "Austin", "Belmont Cragin", "Beverly", "Bridgeport", "Bronzeville", "Chatham", "Edgewater", "Gold Coast", "Hermosa", "Hyde Park", "Irving Park", "Jefferson Park", "Lakeview", "Lincoln Park", "Lincoln Square", "Little Village", "North Center", "Old Town", "Pilsen", "Portage Park", "River North", "Rogers Park", "Roscoe Village", "South Loop", "The Loop", "Uptown", "West Loop", "Woodlawn"];

export async function GET() {
  const s = await getServerSession(authOptions);
  if (!(s?.user && (s.user as any).role === "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ clusters: [{ name: "Wicker Park area", areas: WP }, { name: "Rest of Chicago", areas: REST }] });
}
