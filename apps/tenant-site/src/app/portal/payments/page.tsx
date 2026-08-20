"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Payment {
  id: string;
  amount: number;
  type: string;
  method: string;
  status: string;
  paidAt: string | null;
  forMonth: string | null;
  receiptUrl: string | null;
  createdAt: string;
}

/* ── Mock data for demo mode ──────────────────────────────── */
const mockPayments: Payment[] = [
  {
    id: "pay-1",
    amount: 185000,
    type: "rent",
    method: "ach",
    status: "completed",
    paidAt: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 3).toISOString(),
    forMonth: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString(),
    receiptUrl: null,
    createdAt: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 3).toISOString(),
  },
  {
    id: "pay-2",
    amount: 185000,
    type: "rent",
    method: "ach",
    status: "completed",
    paidAt: new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString(),
    forMonth: new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString(),
    receiptUrl: null,
    createdAt: new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString(),
  },
  {
    id: "pay-3",
    amount: 5000,
    type: "late_fee",
    method: "card",
    status: "completed",
    paidAt: new Date(new Date().getFullYear(), new Date().getMonth() - 3, 8).toISOString(),
    forMonth: new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1).toISOString(),
    receiptUrl: null,
    createdAt: new Date(new Date().getFullYear(), new Date().getMonth() - 3, 8).toISOString(),
  },
  {
    id: "pay-4",
    amount: 185000,
    type: "rent",
    method: "check",
    status: "completed",
    paidAt: new Date(new Date().getFullYear(), new Date().getMonth() - 3, 2).toISOString(),
    forMonth: new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1).toISOString(),
    receiptUrl: null,
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

function formatMethod(method: string): string {
  const map: Record<string, string> = {
    ach: "ACH",
    card: "Credit/Debit Card",
    cash: "Cash",
    check: "Check",
    bank_transfer: "Bank Transfer",
    credit_card: "Credit Card",
    debit_card: "Debit Card",
  };
  return map[method] || method;
}

function formatType(type: string): string {
  const map: Record<string, string> = {
    rent: "Rent",
    late_fee: "Late Fee",
    security_deposit: "Security Deposit",
    other: "Other",
  };
  return map[type] || type;
}

function PaymentStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-green-50 text-green-700",
    pending: "bg-yellow-50 text-yellow-700",
    processing: "bg-blue-50 text-blue-700",
    failed: "bg-red-50 text-red-700",
    refunded: "bg-gray-100 text-gray-600",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
        styles[status] || "bg-gray-100 text-gray-600"
      }`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

interface BalanceSummary {
  balance: number;
  nextDueDate: string | null;
  nextDueAmount: number;
  overdueAmount: number;
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [balanceSummary, setBalanceSummary] = useState<BalanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [paymentsRes, portalRes] = await Promise.all([
          fetch("/api/portal/payments"),
          fetch("/api/portal"),
        ]);

        let demoMode = false;

        if (paymentsRes.ok) {
          const data = await paymentsRes.json();
          setPayments(data.payments ?? []);
        } else {
          setPayments(mockPayments);
          setIsDemo(true);
          demoMode = true;
        }

        if (portalRes.ok) {
          const portalData = await portalRes.json();
          setBalanceSummary({
            balance: portalData.balance ?? 0,
            nextDueDate: portalData.nextDueDate ?? null,
            nextDueAmount: portalData.nextDueAmount ?? 0,
            overdueAmount: portalData.overdueAmount ?? 0,
          });
        } else {
          // Fall back to demo balance summary
          setBalanceSummary({
            balance: 185000,
            nextDueDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
            nextDueAmount: 185000,
            overdueAmount: 0,
          });
          if (!demoMode) {
            setIsDemo(true);
          }
        }
      } catch {
        setPayments(mockPayments);
        setIsDemo(true);
        setBalanceSummary({
          balance: 185000,
          nextDueDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
          nextDueAmount: 185000,
          overdueAmount: 0,
        });
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
          <p className="mt-1 text-sm text-gray-500">
            View your payment history and make new payments.
          </p>
        </div>
        <Link
          href="/portal/payments/pay"
          className="btn-primary inline-flex items-center gap-2"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Pay Now
        </Link>
      </div>

      {/* Demo banner */}
      {isDemo && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <svg className="h-5 w-5 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-amber-700">
            Showing sample data. Sign in to see your actual payments.
          </p>
        </div>
      )}

      {/* Balance summary card */}
      {balanceSummary && (
        <div className="card overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-6 gap-4">
            <div>
              <p className="text-sm font-medium text-gray-500">Current Balance</p>
              <p className={`mt-1 text-3xl font-bold ${balanceSummary.balance > 0 ? "text-orange-600" : "text-green-600"}`}>
                ${formatCents(balanceSummary.balance)}
              </p>
              {balanceSummary.overdueAmount > 0 && (
                <p className="mt-1 text-sm font-medium text-red-500">
                  ${formatCents(balanceSummary.overdueAmount)} overdue
                </p>
              )}
              {balanceSummary.nextDueDate && balanceSummary.nextDueAmount > 0 && (
                <p className="mt-1 text-sm text-gray-500">
                  Next due: ${formatCents(balanceSummary.nextDueAmount)} on{" "}
                  {formatDate(balanceSummary.nextDueDate)}
                </p>
              )}
            </div>
            <Link
              href="/portal/payments/pay"
              className="btn-primary inline-flex items-center gap-2 self-start sm:self-center"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Pay Now
            </Link>
          </div>
        </div>
      )}

      {/* Table */}
      {payments.length === 0 ? (
        <div className="card p-12 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
          </svg>
          <p className="mt-4 text-sm font-medium text-gray-900">No payments yet</p>
          <p className="mt-1 text-sm text-gray-500">
            When you make a payment, it will appear here.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Method
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Receipt
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-gray-50 transition-colors">
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                      {payment.paidAt
                        ? formatDate(payment.paidAt)
                        : formatDate(payment.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-gray-900">
                      ${formatCents(payment.amount)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                      {formatType(payment.type)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {formatMethod(payment.method)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <PaymentStatusBadge status={payment.status} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      {payment.receiptUrl ? (
                        <a
                          href={payment.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-blue-600 hover:text-blue-700"
                        >
                          Download
                        </a>
                      ) : (
                        <span className="text-sm text-gray-400">--</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
