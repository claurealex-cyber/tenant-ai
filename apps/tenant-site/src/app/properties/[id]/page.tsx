"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

/* ── Types matching /api/properties/[id] response ─────────── */
interface Unit {
  id: string;
  unitNumber: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number | null;
  monthlyRent: number;
  description: string | null;
  petPolicy: string | null;
  parkingInfo: string | null;
  utilitiesIncluded: string | null;
  laundry: string | null;
  availableDate: string | null;
}

interface Photo {
  id: string;
  url: string;
  caption: string | null;
}

interface Property {
  id: string;
  name: string;
  address: string;
  description: string | null;
  amenities: string[];
  petPolicy: string | null;
  twilioPhone: string | null;
  units: Unit[];
  photos: Photo[];
  questions: { id: string; text: string; fieldKey: string; type: string; required: boolean }[];
  hasTourSlots: boolean;
}

/* ── Placeholder gradients ────────────────────────────────── */
const gradients = [
  "from-blue-400 to-indigo-500",
  "from-emerald-400 to-teal-500",
  "from-orange-400 to-rose-500",
  "from-purple-400 to-pink-500",
];

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    return `(${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

export default function PropertyDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/properties/${id}`);
        if (!res.ok) {
          if (res.status === 404) throw new Error("Property not found");
          throw new Error("Failed to load property");
        }
        const data = await res.json();
        setProperty(data.property);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Something went wrong"
        );
      } finally {
        setLoading(false);
      }
    }
    if (id) load();
  }, [id]);

  /* ── Loading state ──────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Loading property...</span>
        </div>
      </div>
    );
  }

  /* ── Error state ────────────────────────────────────────── */
  if (error || !property) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
        <div className="mx-auto h-16 w-16 rounded-full bg-red-50 flex items-center justify-center">
          <svg className="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-semibold text-gray-900">
          {error || "Property not found"}
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          This property may no longer be available.
        </p>
        <Link href="/" className="btn-primary mt-6">
          Back to Properties
        </Link>
      </div>
    );
  }

  const minRent = property.units.length > 0 ? Math.min(...property.units.map((u) => u.monthlyRent)) : null;
  const maxRent = property.units.length > 0 ? Math.max(...property.units.map((u) => u.monthlyRent)) : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/" className="hover:text-gray-700">
          Properties
        </Link>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-gray-900 font-medium">{property.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* ── Left column: details ───────────────────────────── */}
        <div className="lg:col-span-2 space-y-8">
          {/* Photo gallery or placeholder */}
          <div className="overflow-hidden rounded-xl">
            {property.photos.length > 0 ? (
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => setLightboxIndex(0)}
                  className="block w-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-xl"
                >
                  <img
                    src={property.photos[0].url}
                    alt={property.photos[0].caption || property.name}
                    className="h-72 w-full rounded-xl object-cover sm:h-96 hover:opacity-90 transition-opacity"
                  />
                </button>
                {property.photos.length > 1 && (
                  <div className="grid grid-cols-3 gap-2">
                    {property.photos.slice(1, 4).map((photo, idx) => (
                      <button
                        type="button"
                        key={photo.id}
                        onClick={() => setLightboxIndex(idx + 1)}
                        className="block w-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg"
                      >
                        <img
                          src={photo.url}
                          alt={photo.caption || property.name}
                          className="h-24 w-full rounded-lg object-cover sm:h-32 hover:opacity-90 transition-opacity"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className={`flex h-72 w-full items-center justify-center rounded-xl bg-gradient-to-br ${gradients[0]} sm:h-96`}>
                <svg className="h-20 w-20 text-white/50" fill="none" viewBox="0 0 24 24" strokeWidth={0.75} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                </svg>
              </div>
            )}
          </div>

          {/* Property name and address */}
          <div>
            <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {property.name}
            </h1>
            <p className="mt-2 flex items-center gap-2 text-gray-500">
              <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
              {property.address}
            </p>
            {minRent !== null && (
              <p className="mt-3 text-2xl font-bold text-blue-600">
                {minRent === maxRent
                  ? `$${formatCents(minRent)}/mo`
                  : `$${formatCents(minRent)} - $${formatCents(maxRent ?? 0)}/mo`}
              </p>
            )}
          </div>

          {/* Description */}
          {property.description && (
            <div>
              <h2 className="text-xl font-semibold text-gray-900">About This Property</h2>
              <p className="mt-3 leading-relaxed text-gray-600 whitespace-pre-line">
                {property.description}
              </p>
            </div>
          )}

          {/* Amenities */}
          {property.amenities && property.amenities.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Amenities</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {property.amenities.map((amenity) => (
                  <div
                    key={amenity}
                    className="flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700"
                  >
                    <svg className="h-4 w-4 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {amenity}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pet Policy */}
          {property.petPolicy && (
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Pet Policy</h2>
              <div className="mt-3 flex items-start gap-3 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75 2.25 2.25 0 012.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904m10.598-9.75H14.25M5.904 18.5c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 9.953 4.167 9.5 5 9.5h1.053c.472 0 .745.556.5.96a8.958 8.958 0 00-1.302 4.665c0 1.194.232 2.333.654 3.375z" />
                </svg>
                <p className="whitespace-pre-line">{property.petPolicy}</p>
              </div>
            </div>
          )}

          {/* Available Units Table */}
          {property.units.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Available Units
                <span className="ml-2 text-sm font-normal text-gray-400">
                  ({property.units.length} available)
                </span>
              </h2>
              <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Unit
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Bedrooms
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Bathrooms
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Sq Ft
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Rent
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {property.units.map((unit) => {
                        const isExpanded = expandedUnitId === unit.id;
                        const hasDetails = unit.description || unit.petPolicy || unit.parkingInfo || unit.utilitiesIncluded || unit.laundry || unit.availableDate;
                        return (
                          <React.Fragment key={unit.id}>
                            <tr
                              className={`transition-colors ${hasDetails ? "cursor-pointer hover:bg-gray-50" : "hover:bg-gray-50"}`}
                              onClick={() => hasDetails && setExpandedUnitId(isExpanded ? null : unit.id)}
                            >
                              <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                                <span className="flex items-center gap-2">
                                  {hasDetails && (
                                    <svg className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                                    </svg>
                                  )}
                                  {unit.unitNumber}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                                {unit.bedrooms} {unit.bedrooms === 1 ? "bed" : "beds"}
                              </td>
                              <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                                {unit.bathrooms} {unit.bathrooms === 1 ? "bath" : "baths"}
                              </td>
                              <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                                {unit.sqft ? `${unit.sqft.toLocaleString()} sqft` : "--"}
                              </td>
                              <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-blue-600">
                                ${formatCents(unit.monthlyRent)}/mo
                              </td>
                            </tr>
                            {isExpanded && hasDetails && (
                              <tr>
                                <td colSpan={5} className="bg-gray-50 px-6 py-4">
                                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                                    {unit.description && (
                                      <div className="sm:col-span-2 lg:col-span-3">
                                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Description</p>
                                        <p className="mt-1 text-gray-700 whitespace-pre-line">{unit.description}</p>
                                      </div>
                                    )}
                                    {unit.availableDate && (
                                      <div>
                                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Available Date</p>
                                        <p className="mt-1 text-gray-700">{new Date(unit.availableDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                                      </div>
                                    )}
                                    {unit.petPolicy && (
                                      <div>
                                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Pet Policy</p>
                                        <p className="mt-1 text-gray-700">{unit.petPolicy}</p>
                                      </div>
                                    )}
                                    {unit.parkingInfo && (
                                      <div>
                                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Parking</p>
                                        <p className="mt-1 text-gray-700">{unit.parkingInfo}</p>
                                      </div>
                                    )}
                                    {unit.utilitiesIncluded && (
                                      <div>
                                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Utilities Included</p>
                                        <p className="mt-1 text-gray-700">{unit.utilitiesIncluded}</p>
                                      </div>
                                    )}
                                    {unit.laundry && (
                                      <div>
                                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Laundry</p>
                                        <p className="mt-1 text-gray-700">{unit.laundry}</p>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Right column: sidebar ──────────────────────────── */}
        <div className="space-y-6">
          {/* Apply card */}
          <div className="card sticky top-24 p-6">
            <h3 className="text-lg font-semibold text-gray-900">
              Interested in This Property?
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              Apply online or by phone. Our AI-powered process makes it fast
              and easy.
            </p>

            {property.hasTourSlots && (
              <Link
                href={`/properties/${property.id}/tours`}
                className="mt-6 flex w-full items-center justify-center rounded-lg border border-blue-500 px-4 py-3 text-sm font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
              >
                <svg className="mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
                </svg>
                Schedule a Tour
              </Link>
            )}

            <Link
              href={`/apply/${property.id}`}
              className={`btn-primary w-full ${property.hasTourSlots ? "mt-3" : "mt-6"}`}
            >
              <svg className="mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              Apply for This Property
            </Link>

            {/* Phone CTA */}
            {property.twilioPhone && (
              <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-100">
                    <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500">
                      Call or text to apply
                    </p>
                    <a
                      href={`tel:${property.twilioPhone}`}
                      className="text-lg font-bold text-blue-600 hover:text-blue-700"
                    >
                      {formatPhone(property.twilioPhone)}
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Info items */}
            <div className="mt-6 space-y-3 text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Instant AI-powered application
              </div>
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Apply online or by phone
              </div>
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Fast response from property manager
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox modal */}
      {lightboxIndex !== null && property.photos.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxIndex(null)}
        >
          <div className="relative max-h-[90vh] max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={property.photos[lightboxIndex].url}
              alt={property.photos[lightboxIndex].caption || property.name}
              className="max-h-[85vh] w-full rounded-lg object-contain"
            />
            {property.photos[lightboxIndex].caption && (
              <p className="mt-2 text-center text-sm text-white/80">
                {property.photos[lightboxIndex].caption}
              </p>
            )}
            {/* Close button */}
            <button
              type="button"
              onClick={() => setLightboxIndex(null)}
              className="absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-800 shadow-lg hover:bg-gray-100"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {/* Previous button */}
            {lightboxIndex > 0 && (
              <button
                type="button"
                onClick={() => setLightboxIndex(lightboxIndex - 1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow-lg hover:bg-white"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
            )}
            {/* Next button */}
            {lightboxIndex < property.photos.length - 1 && (
              <button
                type="button"
                onClick={() => setLightboxIndex(lightboxIndex + 1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow-lg hover:bg-white"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            )}
            {/* Counter */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
              {lightboxIndex + 1} / {property.photos.length}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
