"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";

interface Property {
  id: string;
  name: string;
  address: string;
  twilioPhone: string | null;
  isActive: boolean;
  cookCounty: boolean;
  createdAt: string;
  _count: { applications: number; units: number };
  vacantUnits?: number;
}

export default function PropertiesPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetch("/api/properties")
      .then((res) => res.json())
      .then((data) => {
        setProperties(data.properties || []);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load properties");
        setLoading(false);
      });
  }, []);

  const filteredProperties = useMemo(() => {
    if (!searchQuery.trim()) return properties;
    const q = searchQuery.toLowerCase();
    return properties.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q)
    );
  }, [properties, searchQuery]);

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Properties</h1>
          <Link
            href="/properties/new"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add Property
          </Link>
        </div>

        {/* Search Input */}
        {!loading && properties.length > 0 && (
          <div className="mb-6">
            <input
              type="text"
              placeholder="Search by name or address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-500">Loading properties...</p>
            </div>
          </div>
        ) : properties.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
            <h3 className="text-lg font-medium text-gray-900">No properties yet</h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by adding your first property.
            </p>
            <Link
              href="/properties/new"
              className="mt-4 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Add Property
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredProperties.map((property) => {
              const totalUnits = property._count.units;
              const available = property.vacantUnits ?? totalUnits;
              return (
                <Link
                  key={property.id}
                  href={`/properties/${property.id}`}
                  className="block rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition hover:shadow-md"
                >
                  <div className="flex items-start justify-between">
                    <h3 className="font-semibold text-gray-900">{property.name}</h3>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        property.isActive
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {property.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">{property.address}</p>

                  {property.twilioPhone ? (
                    <p className="mt-2 text-sm font-mono text-gray-700">
                      {property.twilioPhone}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-amber-600">No phone -- Set up</p>
                  )}

                  <div className="mt-4 flex gap-4 text-xs text-gray-500">
                    <span>{property._count.applications} applications</span>
                    <span>{available} of {totalUnits} units available</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
