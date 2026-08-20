"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/* ── Types matching /api/properties response ──────────────── */
interface Property {
  id: string;
  name: string;
  address: string;
  description: string | null;
  amenities: string[];
  availableUnits: number;
  rentMin: number | null;
  rentMax: number | null;
  photo: string | null;
  hasTourSlots: boolean;
}

interface Branding {
  companyName: string;
  logoUrl: string | null;
  primaryColor: string;
  heroImageUrl: string | null;
  aboutText: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

/* ── Placeholder gradients for property cards ─────────────── */
const gradients = [
  "from-blue-400 to-indigo-500",
  "from-emerald-400 to-teal-500",
  "from-orange-400 to-rose-500",
  "from-purple-400 to-pink-500",
  "from-cyan-400 to-blue-500",
  "from-amber-400 to-orange-500",
];

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatRent(min: number | null, max: number | null): string {
  if (min === null && max === null) return "Contact for pricing";
  if (min === max || max === null)
    return `$${formatCents(min ?? 0)}/mo`;
  if (min === null) return `Up to $${formatCents(max)}/mo`;
  return `$${formatCents(min)} - $${formatCents(max)}/mo`;
}

export default function HomePage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/properties");
        if (!res.ok) throw new Error("Failed to load properties");
        const data = await res.json();
        setProperties(data.properties ?? []);
        setBranding(data.branding ?? null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Something went wrong"
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800">
        {/* Decorative blobs */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full bg-white/5 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8 lg:py-40">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
              {branding?.companyName ? (
                <>
                  Welcome to
                  <br />
                  <span className="text-blue-200">{branding.companyName}</span>
                </>
              ) : (
                <>
                  Find Your
                  <br />
                  <span className="text-blue-200">Next Home</span>
                </>
              )}
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-blue-100/90 sm:text-xl">
              {branding?.aboutText ||
                "Browse available rentals and apply instantly -- online or by phone. Our AI-powered system makes the application process fast, friendly, and hassle-free."}
            </p>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <a href="#properties" className="btn-primary !bg-white !text-blue-700 hover:!bg-blue-50">
                Browse Properties
              </a>
              {branding?.contactPhone ? (
                <a
                  href={`tel:${branding.contactPhone}`}
                  className="flex items-center gap-3 rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm text-white bg-white/10 hover:bg-white/20 transition-colors"
                >
                  <svg
                    className="h-5 w-5 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
                    />
                  </svg>
                  <span>Call to Apply: {branding.contactPhone}</span>
                </a>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm text-white bg-white/10">
                  <svg
                    className="h-5 w-5 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
                    />
                  </svg>
                  <span>Call or text to apply by phone</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Featured Properties ───────────────────────────────── */}
      <section id="properties" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Featured Properties
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-500">
            Explore our available rentals. Each property offers online and
            phone-based applications with AI-assisted processing.
          </p>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="mt-16 flex items-center justify-center">
            <div className="flex items-center gap-3 text-gray-500">
              <svg
                className="h-5 w-5 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span className="text-sm">Loading properties...</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="mt-16 text-center">
            <div className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
              {error}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && properties.length === 0 && (
          <div className="mt-16 text-center">
            <div className="mx-auto h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center">
              <svg
                className="h-8 w-8 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
                />
              </svg>
            </div>
            <h3 className="mt-4 text-lg font-semibold text-gray-900">
              No properties available
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              Check back soon -- new listings are added regularly.
            </p>
          </div>
        )}

        {/* Property grid */}
        {!loading && !error && properties.length > 0 && (
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {properties.map((property, idx) => (
              <Link
                key={property.id}
                href={`/properties/${property.id}`}
                className="card group overflow-hidden"
              >
                {/* Photo or gradient placeholder */}
                <div className="relative h-48 overflow-hidden">
                  {property.photo ? (
                    <img
                      src={property.photo}
                      alt={property.name}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div
                      className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${
                        gradients[idx % gradients.length]
                      }`}
                    >
                      <svg
                        className="h-12 w-12 text-white/60"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1}
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

                  {/* Badges */}
                  <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
                    {property.availableUnits > 0 && (
                      <div className="rounded-full bg-green-500 px-3 py-1 text-xs font-semibold text-white shadow">
                        {property.availableUnits} unit
                        {property.availableUnits > 1 ? "s" : ""} available
                      </div>
                    )}
                    {property.hasTourSlots && (
                      <div className="rounded-full bg-blue-500 px-3 py-1 text-xs font-semibold text-white shadow">
                        Tours Available
                      </div>
                    )}
                  </div>
                </div>

                {/* Card body */}
                <div className="p-5">
                  <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                    {property.name}
                  </h3>
                  <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">
                    <svg
                      className="h-4 w-4 flex-shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
                      />
                    </svg>
                    {property.address}
                  </p>

                  {/* Rent */}
                  <p className="mt-3 text-xl font-bold text-blue-600">
                    {formatRent(property.rentMin, property.rentMax)}
                  </p>

                  {/* Amenities */}
                  {property.amenities && property.amenities.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {property.amenities.slice(0, 4).map((amenity) => (
                        <span key={amenity} className="badge">
                          {amenity}
                        </span>
                      ))}
                      {property.amenities.length > 4 && (
                        <span className="badge !bg-gray-100 !text-gray-500">
                          +{property.amenities.length - 4} more
                        </span>
                      )}
                    </div>
                  )}

                  {/* CTA */}
                  <div className="mt-4 flex items-center text-sm font-medium text-blue-600 group-hover:text-blue-700">
                    View Details
                    <svg
                      className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                      />
                    </svg>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── CTA Section ──────────────────────────────────────── */}
      <section className="bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-700 p-8 text-center sm:p-12">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/20">
              <svg
                className="h-7 w-7 text-white"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
                />
              </svg>
            </div>
            <h2 className="mt-6 text-2xl font-bold text-white sm:text-3xl">
              Prefer to Apply by Phone?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-blue-100">
              Call or text the number listed on any property page. Our
              AI assistant will walk you through the entire application --
              no forms, no hassle.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
