"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";
import Pagination, { usePagination } from "@/components/Pagination";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Property {
  id: string;
  name: string;
}

interface CallLog {
  id: string;
  propertyId: string;
  callerPhone: string;
  channel: string;
  duration: number | null;
  estimatedCostCents: number | null;
  reconnectCount: number;
  summary: string | null;
  startedAt: string;
  endedAt: string | null;
  property: {
    id: string;
    name: string;
  };
  application?: {
    id: string;
  } | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Summary {
  totalCalls: number;
  totalDurationSeconds: number;
  totalEstimatedCostCents: number;
}

interface TranscriptMessage {
  role: string;
  content: string;
  timestamp?: string;
}

interface CallLogDetail {
  id: string;
  callerPhone: string;
  channel: string;
  transcript: TranscriptMessage[] | null;
  summary: string | null;
  property: { id: string; name: string };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const CHANNEL_FILTERS = [
  { label: "All", value: "" },
  { label: "Voice", value: "voice" },
  { label: "SMS", value: "sms" },
];

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

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatSummaryDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatCents(cents: number | null): string {
  if (cents === null || cents === undefined) return "--";
  return (
    "$" +
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function formatTotalCents(cents: number): string {
  return (
    "$" +
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ChannelBadge({ channel }: { channel: string }) {
  if (channel === "voice") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
        <svg
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
          />
        </svg>
        Voice
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700">
      <svg
        className="h-3 w-3"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
        />
      </svg>
      SMS
    </span>
  );
}

function TranscriptModal({
  callLogId,
  onClose,
}: {
  callLogId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CallLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/call-logs/${callLogId}`);
        if (!res.ok) {
          setError("Failed to load transcript");
          setLoading(false);
          return;
        }
        const data = await res.json();
        setDetail(data.callLog);
      } catch {
        setError("Failed to load transcript");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [callLogId]);

  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const transcript: TranscriptMessage[] = Array.isArray(detail?.transcript)
    ? (detail.transcript as TranscriptMessage[])
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Call Transcript{" "}
            {detail?.callerPhone ? (
              <span className="font-normal text-gray-500">
                &mdash; {detail.callerPhone}
              </span>
            ) : null}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                <p className="mt-3 text-sm text-gray-500">
                  Loading transcript...
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : transcript.length === 0 ? (
            <div className="py-12 text-center">
              <svg
                className="mx-auto h-12 w-12 text-gray-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
                />
              </svg>
              <p className="mt-3 text-sm text-gray-500">
                No transcript available for this call.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {transcript.map((msg, idx) => {
                const isAI =
                  msg.role === "ai" || msg.role === "assistant";
                return (
                  <div
                    key={idx}
                    className={`flex ${isAI ? "justify-start" : "justify-end"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                        isAI
                          ? "bg-gray-100 text-gray-800"
                          : "bg-blue-600 text-white"
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      {msg.timestamp && (
                        <p
                          className={`mt-1 text-xs ${
                            isAI ? "text-gray-400" : "text-blue-200"
                          }`}
                        >
                          {msg.timestamp}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-3 flex items-center gap-3">
          <button
            onClick={onClose}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            Close
          </button>
          {transcript.length > 0 && (
            <CopyTranscriptButton transcript={transcript} />
          )}
        </div>
      </div>
    </div>
  );
}

function CopyTranscriptButton({ transcript }: { transcript: TranscriptMessage[] }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const text = transcript
      .map((msg) => {
        const label = msg.role === "ai" || msg.role === "assistant" ? "AI" : "Caller";
        return `[${label}]: ${msg.content}`;
      })
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      {copied ? "Copied!" : "Copy Transcript"}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function CallLogsPage() {
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  const { totalPages, getSkip } = usePagination(totalCount, 25);

  // Transcript modal
  const [transcriptId, setTranscriptId] = useState<string | null>(null);

  // Load properties for the filter dropdown
  useEffect(() => {
    async function loadProperties() {
      try {
        const res = await fetch("/api/properties");
        if (res.ok) {
          const data = await res.json();
          setProperties(data.properties || []);
        }
      } catch {
        // Silently fail — the filter just won't show property options
      }
    }
    loadProperties();
  }, []);

  // Load call logs
  const loadCallLogs = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      params.set("skip", String(getSkip(page)));
      params.set("limit", "25");
      if (propertyId) params.set("propertyId", propertyId);
      if (channelFilter) params.set("channel", channelFilter);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);

      const res = await fetch(`/api/call-logs?${params.toString()}`);
      if (!res.ok) {
        setError("Failed to load call logs");
        setLoading(false);
        return;
      }

      const data = await res.json();
      setCallLogs(data.callLogs || []);
      setTotalCount(data.pagination?.total ?? data.total ?? 0);
      setSummary(data.summary || null);
    } catch {
      setError("Failed to load call logs");
    } finally {
      setLoading(false);
    }
  }, [page, propertyId, channelFilter, fromDate, toDate, getSkip]);

  useEffect(() => {
    loadCallLogs();
  }, [loadCallLogs]);

  function handlePropertyFilter(value: string) {
    setPropertyId(value);
    setPage(1);
  }

  function handleChannelFilter(value: string) {
    setChannelFilter(value);
    setPage(1);
  }

  function handleFromDate(value: string) {
    setFromDate(value);
    setPage(1);
  }

  function handleToDate(value: string) {
    setToDate(value);
    setPage(1);
  }

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Call Logs</h1>
            <p className="mt-1 text-sm text-gray-500">
              View call and SMS conversation history across your properties.
            </p>
          </div>
          <a
            href="/api/call-logs/export"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export CSV
          </a>
        </div>

        {/* Filter Bar */}
        <div className="mb-6 flex flex-wrap items-end gap-4">
          {/* Property Dropdown */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Property
            </label>
            <select
              value={propertyId}
              onChange={(e) => handlePropertyFilter(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Properties</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Channel Chips */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Channel
            </label>
            <div className="flex gap-2">
              {CHANNEL_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => handleChannelFilter(filter.value)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    channelFilter === filter.value
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date Range */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              From
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => handleFromDate(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              To
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => handleToDate(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-500">
                Loading call logs...
              </p>
            </div>
          </div>
        ) : callLogs.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
              />
            </svg>
            <h3 className="mt-3 text-lg font-medium text-gray-900">
              No call logs yet
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Calls will appear here once tenants start calling your AI numbers.
            </p>
          </div>
        ) : (
          <>
            {/* Table */}
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Date / Time
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Property
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Caller Phone
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Channel
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Duration
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Est. Cost
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Reconnects
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Application
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {callLogs.map((log) => (
                      <tr
                        key={log.id}
                        className="transition-colors hover:bg-gray-50"
                      >
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                          {formatDateTime(log.startedAt)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                          {log.property.name}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm font-mono text-gray-500">
                          {log.callerPhone}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <ChannelBadge channel={log.channel} />
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                          {formatDuration(log.duration)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                          {formatCents(log.estimatedCostCents)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                          {log.reconnectCount}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {log.application?.id ? (
                            <Link
                              href={`/applications/${log.application.id}`}
                              className="text-blue-600 hover:text-blue-700 font-medium"
                            >
                              View App
                            </Link>
                          ) : log.summary ? (
                            <span className="text-gray-500 line-clamp-1 max-w-[200px]" title={log.summary}>
                              {log.summary}
                            </span>
                          ) : (
                            <span className="text-gray-400">--</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <button
                            onClick={() => setTranscriptId(log.id)}
                            className="inline-flex items-center gap-1 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 hover:bg-blue-50 transition-colors"
                          >
                            <svg
                              className="h-3.5 w-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                              />
                            </svg>
                            View Transcript
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary Row */}
              {summary && (
                <div className="border-t border-gray-200 bg-gray-50 px-6 py-3">
                  <p className="text-sm font-medium text-gray-700">
                    Total: {summary.totalCalls}{" "}
                    {summary.totalCalls === 1 ? "call" : "calls"} |{" "}
                    {formatSummaryDuration(summary.totalDurationSeconds)} |{" "}
                    {formatTotalCents(summary.totalEstimatedCostCents)}
                  </p>
                </div>
              )}
            </div>

            {/* Pagination */}
            <div className="mt-6">
              <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          </>
        )}
      </div>

      {/* Transcript Modal */}
      {transcriptId && (
        <TranscriptModal
          callLogId={transcriptId}
          onClose={() => setTranscriptId(null)}
        />
      )}
    </DashboardShell>
  );
}
