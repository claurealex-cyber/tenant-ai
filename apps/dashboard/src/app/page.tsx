"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";

interface DashboardStats {
  applicationsToday: number;
  inProgress: number;
  completedThisMonth: number;
  estimatedCostCents: number;
}

interface Application {
  id: string;
  fullName: string | null;
  callerPhone: string | null;
  channel: string;
  status: string;
  createdAt: string;
  property: {
    id: string;
    name: string;
  };
}

interface Property {
  id: string;
  name: string;
  twilioPhone: string | null;
  _count: { applications: number };
}

interface TourBooking {
  id: string;
  name: string;
  date: string;
  source: string;
  status: string;
  property: { id: string; name: string };
}

interface MaintenanceRequest {
  id: string;
  title: string;
  priority: string;
  status: string;
  createdAt: string;
  property: { id: string; name: string };
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-green-100 text-green-700",
    reviewed: "bg-green-100 text-green-700",
    in_progress: "bg-yellow-100 text-yellow-700",
    rejected: "bg-red-100 text-red-700",
  };

  const labels: Record<string, string> = {
    completed: "Completed",
    reviewed: "Reviewed",
    in_progress: "In Progress",
    rejected: "Rejected",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
        styles[status] || "bg-gray-100 text-gray-700"
      }`}
    >
      {labels[status] || status}
    </span>
  );
}

function ChannelLabel({ channel }: { channel: string }) {
  const styles: Record<string, string> = {
    voice: "bg-blue-100 text-blue-700",
    sms: "bg-purple-100 text-purple-700",
    web: "bg-teal-100 text-teal-700",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
        styles[channel] || "bg-gray-100 text-gray-700"
      }`}
    >
      {channel === "voice" ? "Voice" : channel === "sms" ? "SMS" : "Web"}
    </span>
  );
}

export default function DashboardHome() {
  const { data: session } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [upcomingTours, setUpcomingTours] = useState<TourBooking[]>([]);
  const [openMaintenance, setOpenMaintenance] = useState<MaintenanceRequest[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [statsRes, appsRes, propsRes, toursRes, maintRes] = await Promise.all([
          fetch("/api/dashboard/stats"),
          fetch("/api/dashboard/recent-applications"),
          fetch("/api/properties"),
          fetch("/api/dashboard/upcoming-tours"),
          fetch("/api/dashboard/open-maintenance"),
        ]);

        if (!statsRes.ok || !appsRes.ok || !propsRes.ok) {
          setError("Failed to load dashboard data");
          setLoading(false);
          return;
        }

        const [statsData, appsData, propsData] = await Promise.all([
          statsRes.json(),
          appsRes.json(),
          propsRes.json(),
        ]);

        setStats(statsData.stats);
        setApplications(appsData.applications || []);
        setProperties(propsData.properties || []);

        if (toursRes.ok) {
          const toursData = await toursRes.json();
          setUpcomingTours(toursData.bookings || []);
        }
        if (maintRes.ok) {
          const maintData = await maintRes.json();
          setOpenMaintenance(maintData.requests || []);
        }

        // Check for overdue payments
        try {
          const overdueRes = await fetch("/api/payments?status=overdue&limit=1");
          if (overdueRes.ok) {
            const overdueData = await overdueRes.json();
            setOverdueCount(overdueData.totalCount ?? overdueData.payments?.length ?? 0);
          }
        } catch {
          // Non-critical, ignore
        }
      } catch {
        setError("Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {session?.user?.name || "there"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Here&apos;s what&apos;s happening with your properties today.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-500">Loading dashboard...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Overdue Rent Alert */}
            {overdueCount > 0 && (
              <div className="mb-6 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                    <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-red-800">
                      Overdue Payments
                    </p>
                    <p className="text-sm text-red-700">
                      You have {overdueCount} overdue rent payment{overdueCount !== 1 ? "s" : ""} that need attention.
                    </p>
                  </div>
                </div>
                <Link
                  href="/payments"
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  View Payments
                </Link>
              </div>
            )}

            {/* Stat Cards */}
            <div className="mb-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm border-t-4 border-t-blue-500">
                <p className="text-sm font-medium text-gray-500">Applications Today</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {stats?.applicationsToday ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm border-t-4 border-t-yellow-500">
                <p className="text-sm font-medium text-gray-500">In Progress</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {stats?.inProgress ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm border-t-4 border-t-green-500">
                <p className="text-sm font-medium text-gray-500">Completed This Month</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {stats?.completedThisMonth ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm border-t-4 border-t-purple-500">
                <p className="text-sm font-medium text-gray-500">Est. Cost This Month</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {formatCurrency(stats?.estimatedCostCents ?? 0)}
                </p>
              </div>
            </div>

            {/* Recent Applications */}
            <div className="mb-8">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Recent Applications</h2>
                <Link
                  href="/applications"
                  className="text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  View all
                </Link>
              </div>

              {applications.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
                  <p className="text-sm text-gray-500">No applications yet.</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Applicant Name
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Property
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Channel
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Date
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {applications.map((app) => (
                        <tr
                          key={app.id}
                          className="hover:bg-gray-50 transition-colors cursor-pointer"
                          onClick={() => router.push(`/applications/${app.id}`)}
                        >
                          <td className="whitespace-nowrap px-6 py-4">
                            <Link
                              href={`/applications/${app.id}`}
                              className="text-sm font-medium text-gray-900 hover:text-blue-600"
                            >
                              {app.fullName || "Unknown"}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                            {app.property.name}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <ChannelLabel channel={app.channel} />
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <StatusBadge status={app.status} />
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                            {formatDate(app.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Upcoming Tours */}
            {upcomingTours.length > 0 && (
              <div className="mb-8">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">Upcoming Tours</h2>
                  <Link
                    href={`/properties/${upcomingTours[0].property.id}?tab=tours`}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    View all
                  </Link>
                </div>
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Date/Time
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Name
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Property
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Source
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {upcomingTours.map((tour) => (
                        <tr
                          key={tour.id}
                          className="hover:bg-gray-50 transition-colors cursor-pointer"
                          onClick={() => router.push(`/properties/${tour.property.id}?tab=tours`)}
                        >
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                            {new Date(tour.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                            {new Date(tour.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                            {tour.name}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                            {tour.property.name}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <ChannelLabel channel={tour.source} />
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                              Confirmed
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Open Maintenance Requests */}
            {openMaintenance.length > 0 && (
              <div className="mb-8">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">Open Maintenance Requests</h2>
                  <Link
                    href="/maintenance"
                    className="text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    View all
                  </Link>
                </div>
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Title
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Property
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Priority
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Created
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {openMaintenance.map((req) => {
                        const priorityStyles: Record<string, string> = {
                          low: "bg-gray-100 text-gray-700",
                          medium: "bg-yellow-100 text-yellow-700",
                          high: "bg-orange-100 text-orange-700",
                          urgent: "bg-red-100 text-red-700",
                        };
                        const statusStyles: Record<string, string> = {
                          open: "bg-yellow-100 text-yellow-700",
                          in_progress: "bg-blue-100 text-blue-700",
                        };
                        return (
                          <tr
                            key={req.id}
                            className="hover:bg-gray-50 transition-colors cursor-pointer"
                            onClick={() => router.push("/maintenance")}
                          >
                            <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                              {req.title}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                              {req.property.name}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4">
                              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${priorityStyles[req.priority] || "bg-gray-100 text-gray-700"}`}>
                                {req.priority.charAt(0).toUpperCase() + req.priority.slice(1)}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4">
                              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[req.status] || "bg-gray-100 text-gray-700"}`}>
                                {req.status === "in_progress" ? "In Progress" : req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                              {formatDate(req.createdAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Properties Quick Links */}
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Your Properties</h2>
                {properties.length > 0 && (
                  <Link
                    href="/properties"
                    className="text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    Manage all
                  </Link>
                )}
              </div>

              {properties.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-50">
                    <svg className="h-7 w-7 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                    </svg>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-gray-900">
                    Add Your First Property
                  </h3>
                  <p className="mt-2 text-sm text-gray-500">
                    Get started by adding a property to begin receiving applications.
                  </p>
                  <Link
                    href="/properties/new"
                    className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Add Property
                  </Link>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {properties.map((property) => (
                    <Link
                      key={property.id}
                      href={`/properties/${property.id}`}
                      className="block rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md"
                    >
                      <h3 className="font-semibold text-gray-900">{property.name}</h3>
                      {property.twilioPhone ? (
                        <p className="mt-1 font-mono text-sm text-gray-600">
                          {property.twilioPhone}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-amber-600">No phone assigned</p>
                      )}
                      <p className="mt-2 text-xs text-gray-500">
                        {property._count.applications} application{property._count.applications !== 1 ? "s" : ""}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
