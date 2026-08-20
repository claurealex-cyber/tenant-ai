"use client";

import { useEffect, useState } from "react";

interface Message {
  id: string;
  subject: string;
  body: string;
  isRead: boolean;
  fromTenantId: string | null;
  replyToId: string | null;
  createdAt: string;
}

/* ── Mock data for demo mode ──────────────────────────────── */
const mockMessages: Message[] = [
  {
    id: "msg-1",
    subject: "Maintenance Update - HVAC System",
    body: "Hello, we wanted to let you know that the HVAC system maintenance has been scheduled for next Tuesday between 9 AM and 12 PM. A technician will need access to your unit. Please ensure someone is available or leave a key at the front office. We apologize for any inconvenience and appreciate your cooperation.",
    isRead: false,
    fromTenantId: null,
    replyToId: null,
    createdAt: new Date(new Date().getFullYear(), new Date().getMonth(), 5).toISOString(),
  },
  {
    id: "msg-2",
    subject: "Lease Renewal Reminder",
    body: "Your current lease is set to expire in 60 days. We would love to have you continue as a tenant. Please review the renewal terms and let us know if you are interested. You can contact us directly or visit the leasing office to discuss any questions about the renewal process.",
    isRead: false,
    fromTenantId: null,
    replyToId: null,
    createdAt: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 20).toISOString(),
  },
  {
    id: "msg-3",
    subject: "Community Event - Holiday Gathering",
    body: "You are invited to our annual community gathering on the 15th of this month at the clubhouse. Food and drinks will be provided. Feel free to bring your family members. RSVP at the front office.",
    isRead: true,
    fromTenantId: null,
    replyToId: null,
    createdAt: new Date(new Date().getFullYear(), new Date().getMonth() - 2, 10).toISOString(),
  },
];

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyError, setReplyError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/portal/messages");
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages ?? []);
        } else {
          setMessages(mockMessages);
          setIsDemo(true);
        }
      } catch {
        setMessages(mockMessages);
        setIsDemo(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleReply(msg: Message) {
    if (!replyText.trim()) return;
    setReplyLoading(true);
    setReplyError("");

    try {
      const res = await fetch("/api/portal/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replyToId: msg.id, body: replyText.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        setReplyError(data.error || "Failed to send reply");
        return;
      }

      const data = await res.json();
      setMessages((prev) => [data.message, ...prev]);
      setReplyText("");
    } catch {
      setReplyError("Failed to send reply");
    } finally {
      setReplyLoading(false);
    }
  }

  async function handleToggle(msg: Message) {
    const isOpening = expandedId !== msg.id;
    setExpandedId(isOpening ? msg.id : null);

    // Mark as read on expand (if unread)
    if (isOpening && !msg.isRead && !isDemo) {
      try {
        const res = await fetch("/api/portal/messages", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: msg.id, isRead: true }),
        });

        if (res.ok) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msg.id ? { ...m, isRead: true } : m
            )
          );
        }
      } catch {
        // Silently fail on mark-as-read
      }
    }

    // Demo mode: update locally
    if (isOpening && !msg.isRead && isDemo) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.id ? { ...m, isRead: true } : m
        )
      );
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  const unreadCount = messages.filter((m) => !m.isRead).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
        <p className="mt-1 text-sm text-gray-500">
          {unreadCount > 0
            ? `You have ${unreadCount} unread message${unreadCount > 1 ? "s" : ""}.`
            : "All messages read."}
        </p>
      </div>

      {/* Demo banner */}
      {isDemo && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <svg className="h-5 w-5 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-amber-700">
            Showing sample data. Sign in to see your actual messages.
          </p>
        </div>
      )}

      {/* Messages list */}
      {messages.length === 0 ? (
        <div className="card p-12 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
          <p className="mt-4 text-sm font-medium text-gray-900">No messages</p>
          <p className="mt-1 text-sm text-gray-500">
            When your landlord sends you a message, it will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((msg) => {
            const isExpanded = expandedId === msg.id;
            const preview =
              msg.body.length > 100
                ? msg.body.slice(0, 100) + "..."
                : msg.body;

            return (
              <button
                key={msg.id}
                onClick={() => handleToggle(msg)}
                className={`card w-full text-left transition-colors ${
                  isExpanded ? "ring-1 ring-blue-200" : "hover:bg-gray-50"
                }`}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      {/* Unread indicator */}
                      <div className="mt-1.5 flex-shrink-0">
                        {!msg.isRead ? (
                          <div className="h-2.5 w-2.5 rounded-full bg-blue-600" />
                        ) : (
                          <div className="h-2.5 w-2.5" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p
                            className={`text-sm truncate ${
                              !msg.isRead
                                ? "font-bold text-gray-900"
                                : "font-medium text-gray-700"
                            }`}
                          >
                            {msg.subject}
                          </p>
                          {msg.fromTenantId && (
                            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                              You
                            </span>
                          )}
                        </div>

                        {!isExpanded && (
                          <p className="mt-1 text-sm text-gray-500 truncate">
                            {preview}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {formatDate(msg.createdAt)}
                      </span>
                      <svg
                        className={`h-4 w-4 text-gray-400 transition-transform ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                        />
                      </svg>
                    </div>
                  </div>

                  {/* Expanded body */}
                  {isExpanded && (
                    <div className="mt-4 ml-5.5 border-t border-gray-100 pt-4">
                      <p className="text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
                        {msg.body}
                      </p>

                      {/* Reply form — only for landlord-sent messages */}
                      {!msg.fromTenantId && !isDemo && (
                        <div className="mt-4 border-t border-gray-100 pt-4">
                          {replyError && (
                            <p className="mb-2 text-sm text-red-600">{replyError}</p>
                          )}
                          <textarea
                            value={replyText}
                            onChange={(e) => {
                              setReplyText(e.target.value);
                              setReplyError("");
                            }}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="Write a reply..."
                            rows={3}
                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              disabled={replyLoading || !replyText.trim()}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReply(msg);
                              }}
                              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              {replyLoading ? "Sending..." : "Reply"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
