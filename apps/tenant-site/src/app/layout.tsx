import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { resolveTenantContext } from "@/lib/tenant-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tenant AI - Find Your Next Home",
  description:
    "Browse properties, apply online or by phone, and manage your tenancy with AI-powered tools.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolve branding from hostname
  let companyName = "Tenant AI";
  let logoUrl: string | null = null;
  let primaryColor = "#2563eb";
  let contactEmail: string | null = null;
  let contactPhone: string | null = null;

  try {
    const headersList = await headers();
    const hostname = headersList.get("x-tenant-host") || headersList.get("host") || "";
    const ctx = await resolveTenantContext(hostname);
    if (ctx) {
      companyName = ctx.companyName || "Tenant AI";
      logoUrl = ctx.logoUrl || null;
      primaryColor = ctx.primaryColor || "#2563eb";
      contactEmail = ctx.contactEmail || null;
      contactPhone = ctx.contactPhone || null;
    }
  } catch {
    // Fallback to defaults on error
  }

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-white text-gray-900">
        {/* ── Header ─────────────────────────────────────────── */}
        <header className="sticky top-0 z-50 border-b border-gray-100 bg-white">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            {/* Brand */}
            <Link href="/" className="flex items-center gap-2">
              {logoUrl ? (
                <img src={logoUrl} alt={companyName} className="h-8 w-8 rounded-lg object-cover" />
              ) : (
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ backgroundColor: primaryColor }}
                >
                  <svg
                    className="h-5 w-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
                    />
                  </svg>
                </div>
              )}
              <span className="text-lg font-bold tracking-tight text-gray-900">
                {companyName}
              </span>
            </Link>

            {/* Navigation */}
            <nav className="hidden items-center gap-1 sm:flex">
              <Link
                href="/"
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
              >
                Properties
              </Link>
              <Link
                href="/login"
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
              >
                Tenant Portal
              </Link>
              <Link
                href="/login"
                className="ml-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
                style={{ backgroundColor: primaryColor }}
              >
                Sign In
              </Link>
            </nav>

            {/* Mobile menu button */}
            <div className="sm:hidden">
              <Link
                href="/login"
                className="rounded-lg px-4 py-2 text-xs font-semibold text-white"
                style={{ backgroundColor: primaryColor }}
              >
                Sign In
              </Link>
            </div>
          </div>
        </header>

        {/* ── Main ───────────────────────────────────────────── */}
        <main className="flex-1">{children}</main>

        {/* ── Footer ─────────────────────────────────────────── */}
        <footer className="border-t border-gray-100 bg-gray-50">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <div className="grid gap-8 sm:grid-cols-3">
              {/* Brand column */}
              <div>
                <div className="flex items-center gap-2">
                  {logoUrl ? (
                    <img src={logoUrl} alt={companyName} className="h-7 w-7 rounded-lg object-cover" />
                  ) : (
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-lg"
                      style={{ backgroundColor: primaryColor }}
                    >
                      <svg
                        className="h-4 w-4 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
                        />
                      </svg>
                    </div>
                  )}
                  <span className="text-sm font-bold text-gray-900">
                    {companyName}
                  </span>
                </div>
                <p className="mt-3 text-sm text-gray-500">
                  AI-powered property management and tenant services.
                </p>
              </div>

              {/* Quick links */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  Quick Links
                </h3>
                <ul className="mt-3 space-y-2">
                  <li>
                    <Link
                      href="/"
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Browse Properties
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/login"
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Tenant Portal
                    </Link>
                  </li>
                </ul>
              </div>

              {/* Contact */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  Contact
                </h3>
                {contactEmail || contactPhone ? (
                  <div className="mt-3 space-y-1">
                    {contactEmail && (
                      <p className="text-sm text-gray-500">
                        <a href={`mailto:${contactEmail}`} className="hover:text-gray-700">{contactEmail}</a>
                      </p>
                    )}
                    {contactPhone && (
                      <p className="text-sm text-gray-500">
                        <a href={`tel:${contactPhone}`} className="hover:text-gray-700">{contactPhone}</a>
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-gray-500">
                    Call or text to apply for any listing. Each property has its
                    own dedicated phone line.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-8 border-t border-gray-200 pt-8 text-center">
              <p className="text-sm text-gray-400">
                &copy; {new Date().getFullYear()} {companyName}. All rights
                reserved.
              </p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
