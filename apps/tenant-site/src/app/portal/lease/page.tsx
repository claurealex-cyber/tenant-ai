"use client";

import { useEffect, useState } from "react";

interface LeaseData {
  id: string;
  unitNumber: string;
  propertyName: string;
  propertyAddress: string;
  monthlyRent: number;
  securityDeposit: number | null;
  startDate: string;
  endDate: string | null;
  leaseType: string;
  rentDueDay: number;
  lateFeeAmount: number | null;
  lateFeeGraceDays: number;
  documentUrl: string | null;
}

/* ── Mock data for demo mode ──────────────────────────────── */
const mockLease: LeaseData = {
  id: "demo-lease",
  unitNumber: "204",
  propertyName: "Sunset Garden Apartments",
  propertyAddress: "456 Elm Street, Anytown, CA 90210",
  monthlyRent: 185000,
  securityDeposit: 185000,
  startDate: "2025-06-01T00:00:00.000Z",
  endDate: "2026-05-31T00:00:00.000Z",
  leaseType: "fixed",
  rentDueDay: 1,
  lateFeeAmount: 5000,
  lateFeeGraceDays: 5,
  documentUrl: null,
};

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function LeaseStatusBadge({ lease }: { lease: LeaseData }) {
  // Month-to-Month
  if (lease.leaseType !== "fixed" || !lease.endDate) {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
        Month-to-Month
      </span>
    );
  }

  // Expired
  if (new Date(lease.endDate) < new Date()) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
        Expired
      </span>
    );
  }

  // Active
  return (
    <span className="inline-flex items-center rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
      Active
    </span>
  );
}

export default function LeasePage() {
  const [lease, setLease] = useState<LeaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/portal/lease");
        if (res.ok) {
          const data = await res.json();
          if (data.lease) {
            setLease(data.lease);
          } else {
            // Authenticated but no lease
            setLease(null);
          }
        } else {
          setLease(mockLease);
          setIsDemo(true);
        }
      } catch {
        setLease(mockLease);
        setIsDemo(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lease Details</h1>
          <p className="mt-1 text-sm text-gray-500">
            View your current lease information and documents.
          </p>
        </div>
        {lease && <LeaseStatusBadge lease={lease} />}
      </div>

      {/* Demo banner */}
      {isDemo && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <svg className="h-5 w-5 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-amber-700">
            Showing sample data. Sign in to see your actual lease details.
          </p>
        </div>
      )}

      {/* No lease state */}
      {!lease ? (
        <div className="card p-12 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <p className="mt-4 text-sm font-medium text-gray-900">No active lease</p>
          <p className="mt-1 text-sm text-gray-500">
            You do not have an active lease on file. Contact your landlord for assistance.
          </p>
        </div>
      ) : (
        <>
          {/* Property & Unit Info */}
          <div className="card overflow-hidden">
            <div className="border-b border-gray-100 bg-gray-50 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-900">Property & Unit</h2>
            </div>
            <div className="p-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                    Property
                  </p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {lease.propertyName}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {lease.propertyAddress}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                    Unit
                  </p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    Unit {lease.unitNumber}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Lease Info Card */}
          <div className="card overflow-hidden">
            <div className="border-b border-gray-100 bg-gray-50 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-900">Lease Terms</h2>
            </div>
            <div className="p-6">
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                    Start Date
                  </p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {formatDate(lease.startDate)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                    End Date
                  </p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {lease.endDate && lease.leaseType === "fixed"
                      ? formatDate(lease.endDate)
                      : "Month-to-Month"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                    Lease Type
                  </p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {lease.leaseType === "fixed" ? "Fixed Term" : "Month-to-Month"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                    Monthly Rent
                  </p>
                  <p className="mt-1 text-lg font-bold text-gray-900">
                    ${formatCents(lease.monthlyRent)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                    Security Deposit
                  </p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {lease.securityDeposit
                      ? `$${formatCents(lease.securityDeposit)}`
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                    Rent Due Day
                  </p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {lease.rentDueDay}{getOrdinalSuffix(lease.rentDueDay)} of each month
                  </p>
                </div>
              </div>

              {/* Late fee terms */}
              {lease.lateFeeAmount && (
                <div className="mt-6 rounded-lg bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                    Late Fee Terms
                  </p>
                  <p className="mt-1 text-sm text-gray-700">
                    A late fee of <span className="font-semibold">${formatCents(lease.lateFeeAmount)}</span> applies
                    if rent is not received within <span className="font-semibold">{lease.lateFeeGraceDays} day{lease.lateFeeGraceDays !== 1 ? "s" : ""}</span> of
                    the due date.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Lease Document */}
          <div className="card overflow-hidden">
            <div className="border-b border-gray-100 bg-gray-50 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-900">Lease Document</h2>
            </div>
            <div className="p-6">
              {lease.documentUrl ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50">
                      <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">Lease Agreement</p>
                      <p className="text-xs text-gray-500">PDF Document</p>
                    </div>
                  </div>
                  <a
                    href={lease.documentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Download
                  </a>
                </div>
              ) : (
                <div className="text-center py-4">
                  <svg className="mx-auto h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <p className="mt-2 text-sm text-gray-500">
                    No lease document uploaded yet.
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    Contact your landlord to request a copy.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
