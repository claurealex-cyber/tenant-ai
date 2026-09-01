"use client";
import DashboardShell from "@/components/layout/DashboardShell";
import ListingsExplorer from "@/components/ListingsExplorer";

export default function ChicagoListingsPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Chicago Listings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Index-page-first: one fetch of a neighborhood index ≈ 50 structured listings, all property types, no key —
            reads public pages and links out. ~10× the coverage of snippet search.
          </p>
        </div>
        <ListingsExplorer provider="public" />
      </div>
    </DashboardShell>
  );
}
