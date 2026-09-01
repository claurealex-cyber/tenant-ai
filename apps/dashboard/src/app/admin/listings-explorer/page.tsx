"use client";
import DashboardShell from "@/components/layout/DashboardShell";
import ListingsExplorer from "@/components/ListingsExplorer";

export default function ListingsExplorerPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Listings Explorer</h1>
          <p className="mt-1 text-sm text-gray-500">All property types (single-family, condo, townhome, multi) via the RentCast licensed API.</p>
        </div>
        <ListingsExplorer />
      </div>
    </DashboardShell>
  );
}
