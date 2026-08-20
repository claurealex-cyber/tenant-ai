"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";

interface NoticeDetail {
  id: string;
  type: "five_day" | "ten_day" | "thirty_day";
  amountOwed: number | null;
  content: string | null;
  pdfUrl: string | null;
  serviceConfirmed: boolean;
  serviceMethod: string | null;
  serviceDate: string | null;
  servedBy: string | null;
  certifiedMailTracking: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  smsSentAt: string | null;
  smsTo: string | null;
  smsSid: string | null;
  createdAt: string;
  updatedAt: string;
  tenant: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };
  lease: {
    id: string;
    unitNumber: string | null;
    property: {
      id: string;
      name: string;
      address: string;
    };
  };
}

const SERVICE_METHODS = [
  { value: "personal", label: "Personal Delivery" },
  { value: "substitute", label: "Substitute Delivery" },
  { value: "certified_mail", label: "Certified Mail" },
];

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    five_day: "bg-red-100 text-red-700",
    ten_day: "bg-yellow-100 text-yellow-700",
    thirty_day: "bg-blue-100 text-blue-700",
  };

  const labels: Record<string, string> = {
    five_day: "5-Day Notice",
    ten_day: "10-Day Notice",
    thirty_day: "30-Day Notice",
  };

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
        styles[type] || "bg-gray-100 text-gray-700"
      }`}
    >
      {labels[type] || type}
    </span>
  );
}

function ServiceBadge({ served }: { served: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
        served ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"
      }`}
    >
      {served ? "Served" : "Unserved"}
    </span>
  );
}

function getNoticeTypeTitle(type: string): string {
  const titles: Record<string, string> = {
    five_day: "5-Day Notice",
    ten_day: "10-Day Notice",
    thirty_day: "30-Day Notice",
  };
  return titles[type] || "Notice";
}

export default function NoticeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [notice, setNotice] = useState<NoticeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Service form state
  const [serviceMethod, setServiceMethod] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [servedBy, setServedBy] = useState("");
  const [certifiedMailTracking, setCertifiedMailTracking] = useState("");
  const [savingService, setSavingService] = useState(false);
  const [serviceSaved, setServiceSaved] = useState(false);
  const [serviceError, setServiceError] = useState("");

  // Content editing state
  const [editingContent, setEditingContent] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [savingContent, setSavingContent] = useState(false);
  const [contentSaved, setContentSaved] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState("");

  // SMS state
  const [sendingSms, setSendingSms] = useState(false);
  const [smsSuccess, setSmsSuccess] = useState("");
  const [smsError, setSmsError] = useState("");

  useEffect(() => {
    async function loadNotice() {
      try {
        const res = await fetch(`/api/notices/${id}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("Notice not found");
          } else {
            setError("Failed to load notice");
          }
          setLoading(false);
          return;
        }

        const data = await res.json();
        setNotice(data.notice);
      } catch {
        setError("Failed to load notice");
      } finally {
        setLoading(false);
      }
    }

    loadNotice();
  }, [id]);

  async function handleSaveService() {
    if (!notice || savingService) return;

    setServiceError("");
    setServiceSaved(false);

    if (!serviceMethod) {
      setServiceError("Please select a service method.");
      return;
    }
    if (!serviceDate) {
      setServiceError("Please enter the date served.");
      return;
    }
    if (!servedBy.trim()) {
      setServiceError("Please enter the name of the person who served.");
      return;
    }
    if (serviceMethod === "certified_mail" && !certifiedMailTracking.trim()) {
      setServiceError(
        "Please enter the certified mail tracking number."
      );
      return;
    }

    setSavingService(true);

    try {
      const body: Record<string, unknown> = {
        serviceMethod,
        serviceDate,
        servedBy: servedBy.trim(),
      };

      if (serviceMethod === "certified_mail") {
        body.certifiedMailTracking = certifiedMailTracking.trim();
      }

      const res = await fetch(`/api/notices/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setServiceError(data.error || "Failed to save service record");
        setSavingService(false);
        return;
      }

      const data = await res.json();
      setNotice(prev => prev ? { ...prev, ...data.notice } : prev);
      setServiceSaved(true);
      setTimeout(() => setServiceSaved(false), 3000);
    } catch {
      setServiceError("Failed to save service record");
    } finally {
      setSavingService(false);
    }
  }

  async function handleSaveContent() {
    if (!notice || savingContent) return;
    setSavingContent(true);
    try {
      const res = await fetch(`/api/notices/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editedContent }),
      });
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      setNotice(prev => prev ? { ...prev, ...data.notice } : prev);
      setEditingContent(false);
      setContentSaved(true);
      setTimeout(() => setContentSaved(false), 3000);
    } catch {
      // silently fail
    } finally {
      setSavingContent(false);
    }
  }

  async function handleSendSms() {
    if (!notice || sendingSms) return;
    setSendingSms(true);
    setSmsSuccess("");
    setSmsError("");
    try {
      const res = await fetch(`/api/notices/${id}/sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        setSmsError(data.error || "Failed to send SMS");
      } else {
        setNotice(prev => prev ? {
          ...prev,
          smsSentAt: data.smsSentAt,
          smsTo: notice.tenant.phone,
          smsSid: data.sid,
        } : prev);
        setSmsSuccess(`SMS sent successfully to ${notice.tenant.phone}`);
        setTimeout(() => setSmsSuccess(""), 5000);
      }
    } catch {
      setSmsError("Failed to send SMS");
    } finally {
      setSendingSms(false);
    }
  }

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/notices" className="hover:text-blue-600">
            Notices
          </Link>
          <span>/</span>
          <span className="text-gray-900">
            {notice ? getNoticeTypeTitle(notice.type) : "Notice Detail"}
          </span>
        </nav>

        {error && (
          <div className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
            <Link
              href="/notices"
              className="ml-2 font-medium text-red-800 underline hover:text-red-900"
            >
              Back to notices
            </Link>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-500">Loading notice...</p>
            </div>
          </div>
        ) : notice ? (
          <div className="space-y-6">
            {/* Notice Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-bold text-gray-900">
                    {getNoticeTypeTitle(notice.type)}
                  </h1>
                  <TypeBadge type={notice.type} />
                  <ServiceBadge served={notice.serviceConfirmed} />
                </div>
                <div className="mt-2 space-y-1">
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Tenant:</span>{" "}
                    {notice.tenant.firstName} {notice.tenant.lastName}
                  </p>
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Property:</span>{" "}
                    {notice.lease.property.name}
                    {notice.lease.unitNumber
                      ? ` - Unit ${notice.lease.unitNumber}`
                      : ""}
                  </p>
                  {notice.type === "five_day" && notice.amountOwed && (
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Amount Owed:</span> $
                      {formatMoney(notice.amountOwed)}
                    </p>
                  )}
                </div>
              </div>

              {notice.pdfUrl && (
                <a
                  href={notice.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  Download PDF
                </a>
              )}
            </div>

            {/* Date Timeline */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">
                Timeline
              </h2>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-0">
                {[
                  {
                    label: "Created",
                    date: notice.createdAt,
                    active: true,
                  },
                  {
                    label: "Served",
                    date: notice.serviceDate,
                    active: !!notice.serviceDate,
                  },
                  {
                    label: "Effective",
                    date: notice.effectiveDate,
                    active: !!notice.effectiveDate,
                  },
                  {
                    label: "Expiration",
                    date: notice.expirationDate,
                    active: !!notice.expirationDate,
                  },
                ].map((item, i, arr) => (
                  <div
                    key={item.label}
                    className="flex flex-1 items-start gap-3 sm:flex-col sm:items-center sm:gap-2"
                  >
                    <div className="flex items-center gap-2 sm:w-full sm:justify-center">
                      {i > 0 && (
                        <div
                          className={`hidden h-px flex-1 sm:block ${
                            item.active ? "bg-blue-400" : "bg-gray-200"
                          }`}
                        />
                      )}
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                          item.active
                            ? "bg-blue-600 text-white"
                            : "bg-gray-200 text-gray-500"
                        }`}
                      >
                        {i + 1}
                      </div>
                      {i < arr.length - 1 && (
                        <div
                          className={`hidden h-px flex-1 sm:block ${
                            arr[i + 1].active ? "bg-blue-400" : "bg-gray-200"
                          }`}
                        />
                      )}
                    </div>
                    <div className="sm:text-center">
                      <p
                        className={`text-sm font-medium ${
                          item.active ? "text-gray-900" : "text-gray-400"
                        }`}
                      >
                        {item.label}
                      </p>
                      <p
                        className={`text-xs ${
                          item.active ? "text-gray-500" : "text-gray-300"
                        }`}
                      >
                        {item.date ? formatDate(item.date) : "Pending"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* SMS Delivery */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">
                SMS Delivery
              </h2>
              {smsSuccess && (
                <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
                  {smsSuccess}
                </div>
              )}
              {smsError && (
                <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
                  {smsError}
                </div>
              )}
              {notice.smsSentAt ? (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="h-5 w-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-medium text-green-800">SMS delivered</span>
                  </div>
                  <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                    <div>
                      <dt className="font-medium text-gray-500">Phone</dt>
                      <dd className="mt-1 text-gray-900">{notice.smsTo || "--"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">Sent</dt>
                      <dd className="mt-1 text-gray-900">{formatDateTime(notice.smsSentAt)}</dd>
                    </div>
                    {notice.smsSid && (
                      <div>
                        <dt className="font-medium text-gray-500">SID</dt>
                        <dd className="mt-1 font-mono text-gray-900 text-xs">{notice.smsSid}</dd>
                      </div>
                    )}
                  </dl>
                  <button
                    onClick={handleSendSms}
                    disabled={sendingSms}
                    className="mt-4 rounded-md border border-blue-300 bg-white px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                  >
                    {sendingSms ? "Sending..." : "Re-send SMS"}
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-500 mb-3">
                    SMS has not been sent to this tenant.
                  </p>
                  {notice.tenant.phone ? (
                    <button
                      onClick={handleSendSms}
                      disabled={sendingSms}
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {sendingSms ? "Sending..." : "Send SMS"}
                    </button>
                  ) : (
                    <p className="text-sm text-amber-600">
                      Tenant has no phone number on file.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Notice Content */}
            {notice.content && (
              <div className="rounded-lg border-2 border-gray-300 bg-white p-8 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Notice Content
                  </h2>
                  {!editingContent && (
                    <button
                      onClick={() => {
                        setEditedContent(notice.content || "");
                        setEditingContent(true);
                      }}
                      className="text-sm font-medium text-blue-600 hover:text-blue-700"
                    >
                      Edit
                    </button>
                  )}
                </div>
                {contentSaved && (
                  <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
                    Content saved successfully.
                  </div>
                )}
                {editingContent ? (
                  <div>
                    <textarea
                      value={editedContent}
                      onChange={(e) => setEditedContent(e.target.value)}
                      rows={20}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm leading-relaxed text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {rewriteError && (
                      <div className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
                        {rewriteError}
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        type="button"
                        disabled={rewriting}
                        onClick={async () => {
                          setRewriting(true);
                          setRewriteError("");
                          try {
                            const res = await fetch("/api/notices/ai-rewrite", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                content: editedContent,
                                noticeType: notice?.type,
                              }),
                            });
                            const data = await res.json();
                            if (!res.ok) {
                              setRewriteError(data.error || "AI rewrite failed.");
                            } else {
                              setEditedContent(data.rewrittenContent);
                            }
                          } catch {
                            setRewriteError("Network error. Please try again.");
                          } finally {
                            setRewriting(false);
                          }
                        }}
                        className="rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                      >
                        {rewriting ? "Rewriting..." : "AI Rewrite"}
                      </button>
                      <button
                        onClick={() => setEditingContent(false)}
                        className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveContent}
                        disabled={savingContent}
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {savingContent ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-gray-800">
                    {notice.content}
                  </pre>
                )}
              </div>
            )}

            {/* Service Tracking Section */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">
                Service Tracking
              </h2>

              {/* Warning */}
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-medium">Illinois Law Requirement</p>
                <p className="mt-1">
                  Notice cannot be served via email/portal only — physical
                  service is required by Illinois law.
                </p>
              </div>

              {notice.serviceConfirmed ? (
                /* Service details (already served) */
                <div>
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <svg
                        className="h-5 w-5 text-green-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <span className="text-sm font-medium text-green-800">
                        Notice has been served
                      </span>
                    </div>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <dt className="text-sm font-medium text-gray-500">
                          Service Method
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900">
                          {SERVICE_METHODS.find(
                            (m) => m.value === notice.serviceMethod
                          )?.label || notice.serviceMethod}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-gray-500">
                          Date Served
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900">
                          {notice.serviceDate
                            ? formatDate(notice.serviceDate)
                            : "--"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-gray-500">
                          Served By
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900">
                          {notice.servedBy || "--"}
                        </dd>
                      </div>
                      {notice.serviceMethod === "certified_mail" &&
                        notice.certifiedMailTracking && (
                          <div>
                            <dt className="text-sm font-medium text-gray-500">
                              Tracking Number
                            </dt>
                            <dd className="mt-1 text-sm font-mono text-gray-900">
                              {notice.certifiedMailTracking}
                            </dd>
                          </div>
                        )}
                    </dl>
                  </div>

                  {/* Auto-calculated dates */}
                  {(notice.effectiveDate || notice.expirationDate) && (
                    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <h3 className="text-sm font-medium text-gray-900 mb-2">
                        Calculated Dates
                      </h3>
                      <dl className="grid gap-3 sm:grid-cols-2">
                        {notice.effectiveDate && (
                          <div>
                            <dt className="text-sm font-medium text-gray-500">
                              Effective Date
                            </dt>
                            <dd className="mt-1 text-sm text-gray-900">
                              {formatDate(notice.effectiveDate)}
                            </dd>
                          </div>
                        )}
                        {notice.expirationDate && (
                          <div>
                            <dt className="text-sm font-medium text-gray-500">
                              Expiration Date
                            </dt>
                            <dd className="mt-1 text-sm text-gray-900">
                              {formatDate(notice.expirationDate)}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}
                </div>
              ) : (
                /* Service form (not yet served) */
                <div className="max-w-lg space-y-4">
                  <div>
                    <label
                      htmlFor="service-method"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Service Method
                    </label>
                    <select
                      id="service-method"
                      value={serviceMethod}
                      onChange={(e) => setServiceMethod(e.target.value)}
                      className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">Select method...</option>
                      {SERVICE_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="service-date"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Date Served
                    </label>
                    <input
                      id="service-date"
                      type="date"
                      value={serviceDate}
                      onChange={(e) => setServiceDate(e.target.value)}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="served-by"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Served By
                    </label>
                    <input
                      id="served-by"
                      type="text"
                      value={servedBy}
                      onChange={(e) => setServedBy(e.target.value)}
                      placeholder="Name of person who served the notice"
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  {serviceMethod === "certified_mail" && (
                    <div>
                      <label
                        htmlFor="tracking-number"
                        className="block text-sm font-medium text-gray-700"
                      >
                        Certified Mail Tracking Number
                      </label>
                      <input
                        id="tracking-number"
                        type="text"
                        value={certifiedMailTracking}
                        onChange={(e) =>
                          setCertifiedMailTracking(e.target.value)
                        }
                        placeholder="e.g., 7021 1970 0000 0000 0000"
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  )}

                  {serviceError && (
                    <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                      {serviceError}
                    </div>
                  )}

                  {serviceSaved && (
                    <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
                      Service record saved successfully.
                    </div>
                  )}

                  <button
                    onClick={handleSaveService}
                    disabled={savingService}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingService ? "Saving..." : "Save Service Record"}
                  </button>
                </div>
              )}
            </div>

            {/* Timestamps */}
            <div className="rounded-lg border border-gray-200 bg-white px-6 py-4 shadow-sm">
              <div className="flex flex-wrap gap-6 text-xs text-gray-400">
                <span>Created: {formatDateTime(notice.createdAt)}</span>
                <span>Updated: {formatDateTime(notice.updatedAt)}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardShell>
  );
}
