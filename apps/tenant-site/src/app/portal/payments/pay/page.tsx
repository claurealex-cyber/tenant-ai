"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

const stripePublishableKey =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
const stripePromise = stripePublishableKey
  ? loadStripe(stripePublishableKey)
  : null;

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: "16px",
      color: "#1f2937",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      "::placeholder": {
        color: "#9ca3af",
      },
    },
    invalid: {
      color: "#dc2626",
      iconColor: "#dc2626",
    },
  },
};

// Inner form component that uses Stripe hooks (must be rendered inside <Elements>)
function CardPaymentForm({
  amount,
  setAmount,
  paymentMethod,
  setPaymentMethod,
  bankAccount,
  leaseId,
  loading,
  setLoading,
  error,
  setError,
  setSuccess,
  setFailed,
  setFailureMessage,
  setPaymentId,
}: {
  amount: string;
  setAmount: (v: string) => void;
  paymentMethod: "bank" | "card";
  setPaymentMethod: (v: "bank" | "card") => void;
  bankAccount: { bankName: string; last4: string } | null;
  leaseId: string | null;
  loading: boolean;
  setLoading: (v: boolean) => void;
  error: string | null;
  setError: (v: string | null) => void;
  setSuccess: (v: boolean) => void;
  setFailed: (v: boolean) => void;
  setFailureMessage: (v: string | null) => void;
  setPaymentId: (v: string | null) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [cardComplete, setCardComplete] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!leaseId) {
      setError("No active lease found. Please contact your landlord.");
      return;
    }

    // Parse the dollar amount and convert to cents
    const parsed = parseFloat(amount.replace(/,/g, ""));
    if (isNaN(parsed) || parsed <= 0) {
      setError("Please enter a valid payment amount.");
      return;
    }

    const amountCents = Math.round(parsed * 100);

    if (paymentMethod === "card") {
      if (!stripe || !elements) {
        setError("Stripe has not loaded yet. Please try again.");
        return;
      }

      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        setError("Card input not found. Please refresh and try again.");
        return;
      }
    }

    setLoading(true);

    try {
      const res = await fetch("/api/portal/payments/create-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountCents,
          leaseId,
          paymentMethodType: paymentMethod,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Payment failed. Please try again.");
        return;
      }

      // For card payments, confirm with Stripe if a clientSecret is returned
      if (paymentMethod === "card" && data.clientSecret) {
        if (!stripe || !elements) {
          setError("Stripe has not loaded yet. Please try again.");
          return;
        }

        const cardElement = elements.getElement(CardElement);
        if (!cardElement) {
          setError("Card input not found. Please refresh and try again.");
          return;
        }

        const { error: stripeError, paymentIntent } =
          await stripe.confirmCardPayment(data.clientSecret, {
            payment_method: {
              card: cardElement,
            },
          });

        if (stripeError) {
          setFailureMessage(stripeError.message || "Card payment failed. Please try again.");
          setFailed(true);
          return;
        }

        if (
          paymentIntent &&
          (paymentIntent.status === "succeeded" ||
            paymentIntent.status === "processing")
        ) {
          setPaymentId(data.paymentId);
          setSuccess(true);
          return;
        }

        // Unexpected status
        setError(
          `Payment status: ${paymentIntent?.status}. Please contact support.`
        );
        return;
      }

      // For bank payments or card payments without clientSecret (handled server-side)
      setPaymentId(data.paymentId);
      setSuccess(true);
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Amount */}
      <div className="card p-6">
        <label
          htmlFor="amount"
          className="block text-sm font-medium text-gray-700"
        >
          Payment Amount
        </label>
        <div className="relative mt-2">
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500">
            $
          </span>
          <input
            id="amount"
            type="text"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input-field pl-7"
            placeholder="0.00"
          />
        </div>
      </div>

      {/* Payment method */}
      <div className="card p-6">
        <p className="text-sm font-medium text-gray-700">Payment Method</p>
        <div className="mt-3 space-y-3">
          {/* Bank Account (ACH) option */}
          {bankAccount ? (
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${
                paymentMethod === "bank"
                  ? "border-blue-600 bg-blue-50"
                  : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              <input
                type="radio"
                name="method"
                value="bank"
                checked={paymentMethod === "bank"}
                onChange={() => setPaymentMethod("bank")}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
                  <svg
                    className="h-5 w-5 text-blue-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Bank Account (ACH)
                  </p>
                  <p className="text-xs text-gray-500">
                    Pay directly from your bank account
                  </p>
                </div>
              </div>
              <span className="ml-auto text-sm text-gray-600">
                {bankAccount.bankName} ····{bankAccount.last4}
              </span>
            </label>
          ) : (
            <label
              className="flex cursor-not-allowed items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 opacity-60"
            >
              <input
                type="radio"
                name="method"
                value="bank"
                disabled
                checked={paymentMethod === "bank"}
                className="h-4 w-4 text-gray-400"
              />
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100">
                  <svg
                    className="h-5 w-5 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">
                    Bank Account (ACH)
                  </p>
                  <p className="text-xs text-gray-400">
                    <Link href="/portal/settings" className="text-blue-500 hover:underline">
                      Link your bank account
                    </Link>{" "}
                    in Settings to pay via ACH
                  </p>
                </div>
              </div>
            </label>
          )}

          {/* Card option */}
          <label
            className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${paymentMethod === "card" ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:bg-gray-50"}`}
          >
            <input
              type="radio"
              name="method"
              value="card"
              checked={paymentMethod === "card"}
              onChange={() => setPaymentMethod("card")}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500"
            />
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100">
                <svg
                  className="h-5 w-5 text-gray-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">
                  Credit or Debit Card
                </p>
                <p className="text-xs text-gray-500">
                  Visa, Mastercard, or American Express
                </p>
              </div>
            </div>
          </label>
        </div>

        {/* Card input area */}
        {paymentMethod === "card" && (
          <div className="mt-4">
            {stripePromise ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-gray-300 bg-white px-4 py-3">
                  <CardElement
                    options={CARD_ELEMENT_OPTIONS}
                    onChange={(e) => setCardComplete(e.complete)}
                  />
                </div>
                <p className="text-xs text-gray-400">
                  Secure payment processing by Stripe
                </p>
              </div>
            ) : (
              <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-6 text-center">
                <svg
                  className="mx-auto h-8 w-8 text-gray-300"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
                  />
                </svg>
                <p className="mt-2 text-sm text-gray-500">
                  Stripe not configured
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Contact your landlord to enable card payments.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Bank payment info area */}
        {paymentMethod === "bank" && bankAccount && (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                <svg
                  className="h-5 w-5 text-blue-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {bankAccount.bankName} ····{bankAccount.last4}
                </p>
                <p className="text-xs text-gray-500">Bank account</p>
              </div>
            </div>
            <p className="mt-3 text-sm text-blue-700">
              Payment will be debited from your bank account. ACH transfers
              typically take 3–5 business days to process.
            </p>
          </div>
        )}

        {/* Bank not linked fallback */}
        {paymentMethod === "bank" && !bankAccount && (
          <div className="mt-4 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-6 text-center">
            <svg
              className="mx-auto h-8 w-8 text-gray-300"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z"
              />
            </svg>
            <p className="mt-2 text-sm text-gray-500">No bank account linked</p>
            <Link
              href="/portal/settings"
              className="mt-2 inline-block text-sm text-blue-600 hover:underline"
            >
              Link your bank in Settings
            </Link>
          </div>
        )}
      </div>

      {/* HB 4206 notice */}
      <div className="rounded-lg border-2 border-blue-200 bg-blue-50 px-4 py-4">
        <div className="flex gap-3">
          <svg
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <div>
            <p className="text-sm font-semibold text-blue-800">
              Illinois HB 4206
            </p>
            <p className="mt-1 text-sm text-blue-700">
              You are not required to pay electronically. Contact your landlord
              for alternative payment methods.
            </p>
          </div>
        </div>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={
          loading ||
          !leaseId ||
          (paymentMethod === "card" && (!stripe || !cardComplete)) ||
          (paymentMethod === "bank" && !bankAccount)
        }
        className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className="h-4 w-4 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Processing...
          </span>
        ) : (
          `Pay $${amount || "0.00"}`
        )}
      </button>
    </form>
  );
}

export default function PayPage() {
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"bank" | "card">("card");
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingLease, setLoadingLease] = useState(true);
  const [loadingBank, setLoadingBank] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [bankAccount, setBankAccount] = useState<{ bankName: string; last4: string } | null>(null);

  useEffect(() => {
    async function loadLease() {
      try {
        const res = await fetch("/api/portal/lease");
        if (res.ok) {
          const data = await res.json();
          if (data.lease) {
            setLeaseId(data.lease.id);
            // Pre-fill amount with monthly rent (cents -> dollars)
            if (data.lease.monthlyRent) {
              setAmount(
                (data.lease.monthlyRent / 100).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              );
            }
          }
        }
      } catch {
        // Will show form without pre-fill
      } finally {
        setLoadingLease(false);
      }
    }
    loadLease();
  }, []);

  useEffect(() => {
    async function loadBankStatus() {
      try {
        const res = await fetch("/api/portal/plaid/status");
        if (res.ok) {
          const data = await res.json();
          if (data.linked && data.bankAccount) {
            setBankAccount(data.bankAccount);
          }
        }
      } catch {
        // Bank status fetch failed — ACH will show as unavailable
      } finally {
        setLoadingBank(false);
      }
    }
    loadBankStatus();
  }, []);

  if (loadingLease || loadingBank) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (failed) {
    return (
      <div className="mx-auto max-w-lg space-y-6">
        <div className="card p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
            <svg
              className="h-7 w-7 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h2 className="mt-4 text-xl font-bold text-gray-900">
            Payment Failed
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {failureMessage || "Your payment could not be processed. Please try again or use a different payment method."}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => {
                setFailed(false);
                setFailureMessage(null);
                setError(null);
              }}
              className="btn-primary inline-block"
            >
              Try Again
            </button>
            <Link
              href="/portal/payments"
              className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Back to Payments
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="mx-auto max-w-lg space-y-6">
        <div className="card p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <svg
              className="h-7 w-7 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12.75l6 6 9-13.5"
              />
            </svg>
          </div>
          <h2 className="mt-4 text-xl font-bold text-gray-900">
            Payment Submitted
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {paymentMethod === "bank"
              ? "Your ACH payment has been submitted. It typically takes 3\u20135 business days to process."
              : "Your payment has been submitted and is being processed."}
          </p>
          {paymentId && (
            <p className="mt-1 text-xs text-gray-400">
              Payment ID: {paymentId}
            </p>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/portal/payments"
              className="btn-primary inline-block"
            >
              View Payments
            </Link>
            <Link
              href="/portal"
              className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const formContent = (
    <div className="mx-auto max-w-lg space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/portal/payments"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5L8.25 12l7.5-7.5"
            />
          </svg>
          Back to Payments
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-gray-900">
          Make a Payment
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Enter your payment details below.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <svg
            className="h-5 w-5 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
          {error}
        </div>
      )}

      {/* No lease warning */}
      {!leaseId && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <svg
            className="h-5 w-5 flex-shrink-0 text-amber-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <p className="text-sm text-amber-700">
            No active lease found. Please sign in or contact your landlord.
          </p>
        </div>
      )}

      {/* Payment form */}
      <CardPaymentForm
        amount={amount}
        setAmount={setAmount}
        paymentMethod={paymentMethod}
        setPaymentMethod={setPaymentMethod}
        bankAccount={bankAccount}
        leaseId={leaseId}
        loading={loading}
        setLoading={setLoading}
        error={error}
        setError={setError}
        setSuccess={setSuccess}
        setFailed={setFailed}
        setFailureMessage={setFailureMessage}
        setPaymentId={setPaymentId}
      />
    </div>
  );

  // Wrap with Elements provider if Stripe is available
  if (stripePromise) {
    return <Elements stripe={stripePromise}>{formContent}</Elements>;
  }

  return formContent;
}
