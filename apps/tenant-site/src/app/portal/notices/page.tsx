"use client";

import { useEffect, useState } from "react";

interface Notice {
  id: string;
  type: string;
  reason: string;
  amountOwed: number | null;
  content: string | null;
  serviceMethod: string | null;
  serviceDate: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  pdfUrl: string | null;
  createdAt: string;
}

/* ── Mock data for demo mode ──────────────────────────────── */
const mockNotices: Notice[] = [
  {
    id: "notice-1",
    type: "five_day",
    reason: "non_payment",
    amountOwed: 185000,
    content: null,
    serviceMethod: "personal",
    serviceDate: new Date(new Date().getFullYear(), new Date().getMonth(), 2).toISOString(),
    effectiveDate: new Date(new Date().getFullYear(), new Date().getMonth(), 2).toISOString(),
    expirationDate: new Date(new Date().getFullYear(), new Date().getMonth(), 7).toISOString(),
    pdfUrl: null,
    createdAt: new Date(new Date().getFullYear(), new Date().getMonth(), 2).toISOString(),
  },
  {
    id: "notice-2",
    type: "ten_day",
    reason: "lease_violation",
    amountOwed: null,
    content: null,
    serviceMethod: "certified_mail",
    serviceDate: new Date(new Date().getFullYear(), new Date().getMonth() - 2, 15).toISOString(),
    effectiveDate: new Date(new Date().getFullYear(), new Date().getMonth() - 2, 15).toISOString(),
    expirationDate: new Date(new Date().getFullYear(), new Date().getMonth() - 2, 25).toISOString(),
    pdfUrl: null,
    createdAt: new Date(new Date().getFullYear(), new Date().getMonth() - 2, 15).toISOString(),
  },
];

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function NoticeTypeBadge({ type }: { type: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    five_day: { bg: "bg-red-50", text: "text-red-700", label: "5-Day" },
    ten_day: { bg: "bg-yellow-50", text: "text-yellow-700", label: "10-Day" },
    thirty_day: { bg: "bg-blue-50", text: "text-blue-700", label: "30-Day" },
  };

  const style = config[type] || { bg: "bg-gray-100", text: "text-gray-600", label: type };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}

function NoticeStatusBadge({ expirationDate }: { expirationDate: string | null }) {
  if (!expirationDate) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600">
        Pending
      </span>
    );
  }

  const expired = new Date(expirationDate) < new Date();

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
        expired ? "bg-gray-100 text-gray-600" : "bg-orange-50 text-orange-700"
      }`}
    >
      {expired ? "Expired" : "Active"}
    </span>
  );
}

export default function NoticesPage() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [expandedNoticeId, setExpandedNoticeId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/portal/notices");
        if (res.ok) {
          const data = await res.json();
          setNotices(data.notices ?? []);
        } else {
          setNotices(mockNotices);
          setIsDemo(true);
        }
      } catch {
        setNotices(mockNotices);
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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Notices</h1>
        <p className="mt-1 text-sm text-gray-500">
          View legal notices related to your tenancy.
        </p>
      </div>

      {/* Demo banner */}
      {isDemo && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <svg className="h-5 w-5 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-amber-700">
            Showing sample data. Sign in to see your actual notices.
          </p>
        </div>
      )}

      {/* Disclaimer banner */}
      <div className="flex items-start gap-3 rounded-lg border-2 border-gray-300 bg-gray-50 px-4 py-3">
        <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
        </svg>
        <p className="text-sm text-gray-600">
          Notices are provided as a convenience. This is not legal service of process.
        </p>
      </div>

      {/* Table */}
      {notices.length === 0 ? (
        <div className="card p-12 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          <p className="mt-4 text-sm font-medium text-gray-900">No notices at this time</p>
          <p className="mt-1 text-sm text-gray-500">
            If you receive a notice, it will appear here.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Date Issued
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Service Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Expiration
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {notices.map((notice) => (
                  <>
                    <tr key={notice.id} className="hover:bg-gray-50 transition-colors">
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="flex items-center gap-2">
                          <NoticeTypeBadge type={notice.type} />
                          {notice.amountOwed && (
                            <span className="text-xs text-gray-500">
                              ${formatCents(notice.amountOwed)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                        {formatDate(notice.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                        {notice.serviceDate ? formatDate(notice.serviceDate) : "--"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                        {notice.expirationDate ? formatDate(notice.expirationDate) : "--"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <NoticeStatusBadge expirationDate={notice.expirationDate} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {notice.content && (
                            <button
                              onClick={() => setExpandedNoticeId(expandedNoticeId === notice.id ? null : notice.id)}
                              className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-800"
                            >
                              View
                              <svg
                                className={`h-3.5 w-3.5 transition-transform ${expandedNoticeId === notice.id ? "rotate-90" : ""}`}
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={2}
                                stroke="currentColor"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                              </svg>
                            </button>
                          )}
                          {notice.pdfUrl ? (
                            <a
                              href={notice.pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                              </svg>
                              PDF
                            </a>
                          ) : (
                            <span className="text-sm text-gray-400 italic">PDF pending</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedNoticeId === notice.id && notice.content && (
                      <tr key={`${notice.id}-content`}>
                        <td colSpan={6} className="bg-gray-50 px-6 py-4">
                          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-sm leading-relaxed text-gray-800">
                            {notice.content}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
