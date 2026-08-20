"use client";

import { useState, useEffect, useCallback } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import Pagination, { usePagination } from "@/components/Pagination";

interface Message {
  id: string;
  subject: string;
  body: string;
  isRead?: boolean;
  fromTenantId: string | null;
  fromTenant: { firstName: string; lastName: string } | null;
  createdAt: string;
  tenant: {
    firstName: string;
    lastName: string;
    email: string;
  };
}

interface Tenant {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const { totalPages, getSkip } = usePagination(totalCount, 25);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // New Message modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [messageForm, setMessageForm] = useState({
    tenantId: "",
    subject: "",
    body: "",
  });
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      params.set("skip", String(getSkip(page)));
      params.set("limit", "25");

      const res = await fetch(`/api/messages?${params.toString()}`);
      if (!res.ok) {
        setError("Failed to load messages");
        setLoading(false);
        return;
      }

      const data = await res.json();
      setMessages(data.messages || []);
      setTotalCount(data.pagination?.total ?? data.total ?? (data.messages || []).length);
    } catch {
      setError("Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, [page, getSkip]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Load tenants when modal opens
  useEffect(() => {
    if (showNewModal && tenants.length === 0) {
      setTenantsLoading(true);
      fetch("/api/tenants")
        .then((res) => res.json())
        .then((data) => setTenants(data.tenants || []))
        .catch(() => {})
        .finally(() => setTenantsLoading(false));
    }
  }, [showNewModal, tenants.length]);

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    setSubmitLoading(true);
    setSubmitError("");
    setSubmitSuccess("");

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: messageForm.tenantId,
          subject: messageForm.subject.trim(),
          body: messageForm.body.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSubmitError(data.error || "Failed to send message");
        setSubmitLoading(false);
        return;
      }

      setSubmitSuccess("Message sent successfully!");
      loadMessages();
      setTimeout(() => {
        setShowNewModal(false);
        setMessageForm({ tenantId: "", subject: "", body: "" });
        setSubmitSuccess("");
      }, 2000);
    } catch {
      setSubmitError("Failed to send message");
    } finally {
      setSubmitLoading(false);
    }
  }

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
            <p className="mt-1 text-sm text-gray-500">
              View and send messages to your tenants.
            </p>
          </div>
          <button
            onClick={() => setShowNewModal(true)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New Message
          </button>
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
              <p className="mt-3 text-sm text-gray-500">Loading messages...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
              />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              No messages yet
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Send your first message to a tenant.
            </p>
            <div className="mt-6">
              <button
                onClick={() => setShowNewModal(true)}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                New Message
              </button>
            </div>
          </div>
        ) : (
          <>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Tenant
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Subject
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Message
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {messages.map((message) => {
                  const unread = message.isRead === false;
                  const isExpanded = expandedId === message.id;
                  return (
                    <tr
                      key={message.id}
                      className={`transition-colors hover:bg-gray-50 cursor-pointer ${unread ? "bg-blue-50/40" : ""}`}
                      onClick={() => setExpandedId(isExpanded ? null : message.id)}
                    >
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        <div className="flex items-center gap-2">
                          {unread && (
                            <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-blue-600" />
                          )}
                          {formatDate(message.createdAt)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div>
                          <p className={`text-sm ${unread ? "font-bold text-gray-900" : "font-medium text-gray-900"}`}>
                            {message.tenant.firstName} {message.tenant.lastName}
                          </p>
                          <p className="text-xs text-gray-500">
                            {message.tenant.email}
                          </p>
                        </div>
                      </td>
                      <td className={`whitespace-nowrap px-6 py-4 text-sm ${unread ? "font-bold text-gray-900" : "font-medium text-gray-900"}`}>
                        <div className="flex items-center gap-2">
                          {message.subject}
                          {message.fromTenantId && (
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                              Reply from {message.fromTenant?.firstName || "Tenant"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {isExpanded ? (
                          <div className="whitespace-pre-wrap">{message.body}</div>
                        ) : (
                          truncate(message.body, 80)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-6">
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
          </>
        )}
      </div>

      {/* New Message Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                New Message
              </h2>
              <button
                onClick={() => {
                  setShowNewModal(false);
                  setSubmitError("");
                  setSubmitSuccess("");
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {submitError && (
              <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
                {submitError}
              </div>
            )}

            {submitSuccess && (
              <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
                {submitSuccess}
              </div>
            )}

            <form onSubmit={handleSendMessage} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Tenant <span className="text-red-500">*</span>
                </label>
                {tenantsLoading ? (
                  <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                    Loading tenants...
                  </div>
                ) : (
                  <select
                    required
                    value={messageForm.tenantId}
                    onChange={(e) =>
                      setMessageForm((f) => ({
                        ...f,
                        tenantId: e.target.value,
                      }))
                    }
                    className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Select a tenant</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.firstName} {t.lastName} ({t.email})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Subject <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={messageForm.subject}
                  onChange={(e) =>
                    setMessageForm((f) => ({ ...f, subject: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Message subject"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Message <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={5}
                  value={messageForm.body}
                  onChange={(e) =>
                    setMessageForm((f) => ({ ...f, body: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Type your message..."
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewModal(false);
                    setSubmitError("");
                    setSubmitSuccess("");
                  }}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitLoading}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitLoading ? "Sending..." : "Send Message"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
