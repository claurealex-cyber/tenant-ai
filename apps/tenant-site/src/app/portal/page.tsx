"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/* ── Types matching /api/portal response ──────────────────── */
interface Lease {
  id: string;
  monthlyRent: number;
  startDate: string;
  endDate: string;
  rentDueDay: number;
  unit: string;
  property: string;
  address: string;
}

interface PortalData {
  lease: Lease | null;
  balance: number;
  nextDueDate: string | null;
  nextDueAmount: number;
  overdueAmount: number;
  unreadNotices: number;
  unreadMessages: number;
  maintenanceCount: number;
  upcomingTour: { id: string; date: string; propertyName: string } | null;
}

interface Payment {
  id: string;
  amount: number;
  type: string;
  method: string;
  status: string;
  paidAt: string | null;
  forMonth: string | null;
  createdAt: string;
}

/* ── Mock data for demo/dev mode ──────────────────────────── */
const mockData: PortalData = {
  lease: {
    id: "demo-lease",
    monthlyRent: 185000,
    startDate: "2025-06-01",
    endDate: "2026-05-31",
    rentDueDay: 1,
    unit: "204",
    property: "Sunset Garden Apartments",
    address: "456 Elm Street, Anytown, CA 90210",
  },
  balance: 185000,
  nextDueDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
  nextDueAmount: 185000,
  overdueAmount: 0,
  unreadNotices: 2,
  unreadMessages: 1,
  maintenanceCount: 1,
  upcomingTour: null,
};

const mockPayments: Payment[] = [
  {
    id: "pay-1",
    amount: 185000,
    type: "rent",
    method: "bank_transfer",
    status: "completed",
    paidAt: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 3).toISOString(),
    forMonth: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString(),
    createdAt: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 3).toISOString(),
  },
  {
    id: "pay-2",
    amount: 185000,
    type: "rent",
    method: "bank_transfer",
    status: "completed",
    paidAt: new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString(),
    forMonth: new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString(),
    createdAt: new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString(),
  },
  {
    id: "pay-3",
    amount: 185000,
    type: "rent",
    method: "credit_card",
    status: "completed",
    paidAt: new Date(new Date().getFullYear(), new Date().getMonth() - 3, 2).toISOString(),
    forMonth: new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1).toISOString(),
    createdAt: new Date(new Date().getFullYear(), new Date().getMonth() - 3, 2).toISOString(),
  },
];

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMonth(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export default function PortalDashboard() {
  const [data, setData] = useState<PortalData | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [tenantName, setTenantName] = useState("Tenant");

  useEffect(() => {
    async function load() {
      try {
        // Attempt to fetch real portal data
        const [portalRes, paymentsRes] = await Promise.all([
          fetch("/api/portal"),
          fetch("/api/portal/payments"),
        ]);

        if (portalRes.ok) {
          const portalData = await portalRes.json();
          setData(portalData);

          if (paymentsRes.ok) {
            const payData = await paymentsRes.json();
            setPayments(payData.payments ?? []);
          }
        } else {
          // Fall back to demo data
          setData(mockData);
          setPayments(mockPayments);
          setIsDemo(true);
          setTenantName("Demo User");
        }
      } catch {
        // Fall back to demo data on any error
        setData(mockData);
        setPayments(mockPayments);
        setIsDemo(true);
        setTenantName("Demo User");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8">
      {/* ── Welcome header ───────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
          Welcome back, {tenantName}
        </h1>
        {data.lease && (
          <p className="mt-1 text-sm text-gray-500">
            {data.lease.property} &middot; Unit {data.lease.unit}
          </p>
        )}
      </div>

      {/* ── Demo banner ──────────────────────────────────────── */}
      {isDemo && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <svg className="h-5 w-5 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-amber-800">
              Demo Mode
            </p>
            <p className="text-xs text-amber-600">
              You are viewing sample data. Sign in to see your actual tenant information.
            </p>
          </div>
        </div>
      )}

      {/* ── Summary cards ────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* Balance due */}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Balance Due</p>
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${data.balance > 0 ? "bg-orange-100" : "bg-green-100"}`}>
              <svg className={`h-5 w-5 ${data.balance > 0 ? "text-orange-600" : "text-green-600"}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <p className={`mt-3 text-2xl font-bold ${data.balance > 0 ? "text-orange-600" : "text-green-600"}`}>
            ${formatCents(data.balance)}
          </p>
          {data.overdueAmount > 0 && (
            <p className="mt-1 text-xs font-medium text-red-500">
              ${formatCents(data.overdueAmount)} overdue
            </p>
          )}
        </div>

        {/* Next due date */}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Next Due Date</p>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
              <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
            </div>
          </div>
          <p className="mt-3 text-2xl font-bold text-gray-900">
            {data.nextDueDate ? formatDate(data.nextDueDate) : "None"}
          </p>
          {data.nextDueAmount > 0 && (
            <p className="mt-1 text-xs text-gray-400">
              ${formatCents(data.nextDueAmount)} due
            </p>
          )}
        </div>

        {/* Notices */}
        <Link href="/portal/notices" className="card p-5 transition-colors hover:bg-purple-50">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Notices</p>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100">
              <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
            </div>
          </div>
          <p className="mt-3 text-2xl font-bold text-gray-900">
            {data.unreadNotices}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {data.unreadNotices === 1 ? "notice" : "notices"}
          </p>
        </Link>

        {/* Messages */}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Messages</p>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100">
              <svg className="h-5 w-5 text-teal-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
          </div>
          <p className="mt-3 text-2xl font-bold text-gray-900">
            {data.unreadMessages}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            unread {data.unreadMessages === 1 ? "message" : "messages"}
          </p>
        </div>

        {/* Maintenance */}
        <Link href="/portal/maintenance" className="card p-5 transition-colors hover:bg-orange-50">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Maintenance</p>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100">
              <svg className="h-5 w-5 text-orange-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.384 3.124A1.125 1.125 0 014.5 17.27V5.608c0-.355.186-.676.49-.856l7.5-4.44a1.125 1.125 0 011.02 0l7.5 4.44c.304.18.49.501.49.856V17.27a1.125 1.125 0 01-1.536 1.024L14.58 15.17M11.42 15.17l1.58.936m-1.58-.936V9.394m0 0a.75.75 0 011.06-.025l3.355 3.178" />
              </svg>
            </div>
          </div>
          <p className="mt-3 text-2xl font-bold text-gray-900">
            {data.maintenanceCount}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            open {data.maintenanceCount === 1 ? "request" : "requests"}
          </p>
        </Link>
      </div>

      {/* ── Quick actions ────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Quick Actions</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/portal/payments/pay"
            className="card flex items-center gap-4 p-5 transition-colors hover:bg-blue-50"
          >
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100">
              <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Pay Now</p>
              <p className="text-xs text-gray-500">Make a payment</p>
            </div>
          </Link>

          <Link
            href="/portal/lease"
            className="card flex items-center gap-4 p-5 transition-colors hover:bg-emerald-50"
          >
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-100">
              <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">View Lease</p>
              <p className="text-xs text-gray-500">View your lease details</p>
            </div>
          </Link>

          <Link
            href="/portal/messages"
            className="card flex items-center gap-4 p-5 transition-colors hover:bg-teal-50"
          >
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-teal-100">
              <svg className="h-6 w-6 text-teal-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Messages</p>
              <p className="text-xs text-gray-500">
                {data.unreadMessages > 0
                  ? `${data.unreadMessages} unread message${data.unreadMessages > 1 ? "s" : ""}`
                  : "No new messages"}
              </p>
            </div>
          </Link>

          <Link
            href="/portal/maintenance"
            className="card flex items-center gap-4 p-5 transition-colors hover:bg-orange-50"
          >
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-orange-100">
              <svg className="h-6 w-6 text-orange-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.384 3.124A1.125 1.125 0 014.5 17.27V5.608c0-.355.186-.676.49-.856l7.5-4.44a1.125 1.125 0 011.02 0l7.5 4.44c.304.18.49.501.49.856V17.27a1.125 1.125 0 01-1.536 1.024L14.58 15.17M11.42 15.17l1.58.936m-1.58-.936V9.394m0 0a.75.75 0 011.06-.025l3.355 3.178" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Submit Request</p>
              <p className="text-xs text-gray-500">Report a maintenance issue</p>
            </div>
          </Link>
        </div>
      </div>

      {/* ── Upcoming Tour ──────────────────────────────────── */}
      {data.upcomingTour && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Upcoming Tour</h2>
          <div className="card mt-4 p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100">
                <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {new Date(data.upcomingTour.date).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}{" "}
                  at{" "}
                  {new Date(data.upcomingTour.date).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </p>
                <p className="text-sm text-gray-500">{data.upcomingTour.propertyName}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Lease details ────────────────────────────────────── */}
      {data.lease && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Lease Summary</h2>
          <div className="card mt-4 overflow-hidden">
            <div className="grid divide-y divide-gray-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <div className="p-5">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Property</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{data.lease.property}</p>
                <p className="mt-0.5 text-xs text-gray-500">{data.lease.address}</p>
                <p className="mt-0.5 text-xs text-gray-500">Unit {data.lease.unit}</p>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Monthly Rent</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">${formatCents(data.lease.monthlyRent)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Due Day</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">{data.lease.rentDueDay}{getOrdinalSuffix(data.lease.rentDueDay)} of month</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Start</p>
                    <p className="mt-1 text-sm text-gray-700">{formatDate(data.lease.startDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">End</p>
                    <p className="mt-1 text-sm text-gray-700">{formatDate(data.lease.endDate)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Recent payments ──────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent Payments</h2>
          <Link
            href="/portal/payments"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            View all
          </Link>
        </div>

        {payments.length === 0 ? (
          <div className="card mt-4 p-8 text-center">
            <svg className="mx-auto h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
            </svg>
            <p className="mt-3 text-sm text-gray-500">No payments recorded yet.</p>
          </div>
        ) : (
          <div className="card mt-4 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">For</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Method</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {payments.slice(0, 5).map((payment) => (
                    <tr key={payment.id} className="hover:bg-gray-50 transition-colors">
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                        {payment.paidAt ? formatDate(payment.paidAt) : formatDate(payment.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                        {payment.forMonth ? formatMonth(payment.forMonth) : payment.type}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {formatMethod(payment.method)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <PaymentStatusBadge status={payment.status} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-semibold text-gray-900">
                        ${formatCents(payment.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Helper components ────────────────────────────────────── */

function PaymentStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-green-50 text-green-700",
    pending: "bg-yellow-50 text-yellow-700",
    failed: "bg-red-50 text-red-700",
    refunded: "bg-gray-100 text-gray-600",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        styles[status] || "bg-gray-100 text-gray-600"
      }`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function formatMethod(method: string): string {
  const map: Record<string, string> = {
    bank_transfer: "Bank Transfer",
    credit_card: "Credit Card",
    debit_card: "Debit Card",
    check: "Check",
    cash: "Cash",
    ach: "ACH",
  };
  return map[method] || method;
}

function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
