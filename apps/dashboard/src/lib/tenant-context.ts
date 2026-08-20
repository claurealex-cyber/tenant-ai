/**
 * Stub for tenant-context resolution.
 *
 * The actual implementation lives in apps/tenant-site/src/lib/tenant-context.ts.
 * This stub exists so that the @/ vitest alias (which maps to apps/dashboard/src/)
 * can resolve imports of "@/lib/tenant-context" used by tenant-site route handlers
 * during testing. Tests mock this module via vi.mock("@/lib/tenant-context", ...).
 */

export interface TenantContext {
  userId: string;
  subdomain?: string | null;
  customDomain?: string | null;
  companyName: string;
  logoUrl?: string | null;
  primaryColor: string;
  heroImageUrl?: string | null;
  aboutText?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

export async function resolveTenantContext(
  _hostname: string
): Promise<TenantContext | null> {
  throw new Error(
    "resolveTenantContext stub — this should be mocked in tests"
  );
}
