import { NextRequest, NextResponse } from "next/server";

/**
 * Tenant-site middleware: resolves landlord from hostname.
 *
 * Sets x-tenant-host header for downstream pages/API routes to use
 * for tenant context resolution. The actual DB lookup happens in the
 * route handlers (not in middleware, to avoid Edge Runtime Prisma issues).
 */
export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";

  // Skip dashboard domain
  const dashboardDomain = process.env.DASHBOARD_DOMAIN || "dashboard.tenantai.com";
  if (hostname.startsWith(dashboardDomain)) {
    return NextResponse.next();
  }

  // Pass the hostname through to API routes via header
  const response = NextResponse.next();
  response.headers.set("x-tenant-host", hostname);

  return response;
}

export const config = {
  // Match all routes except static files and Next.js internals
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
