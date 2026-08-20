"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import { usePlaidLink, PlaidLinkOnSuccess } from "react-plaid-link";

/* ── Types ────────────────────────────────────────────────── */
interface ProfileData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  bankName?: string | null;
  bankAccountLast4?: string | null;
  bankAccount?: {
    bankName: string;
    last4: string;
  } | null;
}

/* ── Mock data for demo mode ──────────────────────────────── */
const mockProfile: ProfileData = {
  firstName: "Demo",
  lastName: "User",
  email: "demo@example.com",
  phone: "(312) 123-4567",
  bankAccount: null,
};

export default function SettingsPage() {
  /* ── Profile state ──────────────────────────────────────── */
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  /* ── Password state ─────────────────────────────────────── */
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  /* ── Bank account state ─────────────────────────────────── */
  const [bankAccount, setBankAccount] = useState<{ bankName: string; last4: string } | null>(null);
  const [bankLinking, setBankLinking] = useState(false);
  const [bankUnlinking, setBankUnlinking] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);

  /* ── Auto-dismiss success/error messages ─────────────────── */
  useEffect(() => {
    if (profileSuccess) {
      const timer = setTimeout(() => setProfileSuccess(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [profileSuccess]);

  useEffect(() => {
    if (passwordSuccess) {
      const timer = setTimeout(() => setPasswordSuccess(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [passwordSuccess]);

  useEffect(() => {
    if (bankError) {
      const timer = setTimeout(() => setBankError(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [bankError]);

  /* ── Load profile on mount ──────────────────────────────── */
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/portal/settings");
        if (res.ok) {
          const data = await res.json();
          // Support both { firstName, ... } and { tenant: { ... } } shapes
          const p: ProfileData = data.tenant ?? data;
          setProfile(p);
          setFirstName(p.firstName);
          setLastName(p.lastName);
          setEmail(p.email);
          setPhone(p.phone || "");
          // Map bank fields from API
          if (p.bankName && p.bankAccountLast4) {
            setBankAccount({ bankName: p.bankName, last4: p.bankAccountLast4 });
          } else if (p.bankAccount) {
            setBankAccount(p.bankAccount);
          }
        } else {
          setProfile(mockProfile);
          setFirstName(mockProfile.firstName);
          setLastName(mockProfile.lastName);
          setEmail(mockProfile.email);
          setPhone(mockProfile.phone || "");
          setIsDemo(true);
        }
      } catch {
        setProfile(mockProfile);
        setFirstName(mockProfile.firstName);
        setLastName(mockProfile.lastName);
        setEmail(mockProfile.email);
        setPhone(mockProfile.phone || "");
        setIsDemo(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  /* ── Plaid Link ─────────────────────────────────────────── */
  const onPlaidSuccess: PlaidLinkOnSuccess = useCallback(async (publicToken, metadata) => {
    setBankLinking(true);
    setBankError(null);
    try {
      const accountId = metadata.accounts[0]?.id;
      if (!accountId) {
        setBankError("No bank account was selected. Please try again.");
        setBankLinking(false);
        return;
      }
      const res = await fetch("/api/portal/plaid/exchange-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicToken, accountId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBankError(data.error || "Failed to link bank account. Please try again.");
        return;
      }
      setBankAccount(data.bankAccount);
      setLinkToken(null);
    } catch {
      setBankError("An unexpected error occurred. Please try again.");
    } finally {
      setBankLinking(false);
    }
  }, []);

  const { open: openPlaidLink, ready: plaidReady } = usePlaidLink({
    token: linkToken,
    onSuccess: onPlaidSuccess,
    onExit: () => {
      setBankLinking(false);
    },
  });

  // Auto-open Plaid Link when token is ready
  useEffect(() => {
    if (linkToken && plaidReady) {
      openPlaidLink();
    }
  }, [linkToken, plaidReady, openPlaidLink]);

  async function handleLinkBank() {
    setBankError(null);
    setBankLinking(true);
    try {
      const res = await fetch("/api/portal/plaid/create-link-token", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setBankError(data.error || "Could not initialize bank linking. Please try again.");
        setBankLinking(false);
        return;
      }
      setLinkToken(data.linkToken);
    } catch {
      setBankError("An unexpected error occurred. Please try again.");
      setBankLinking(false);
    }
  }

  async function handleUnlinkBank() {
    if (!window.confirm("Are you sure you want to unlink your bank account? You will need to link again to make ACH payments.")) {
      return;
    }
    setBankUnlinking(true);
    setBankError(null);
    try {
      const res = await fetch("/api/portal/plaid/unlink", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setBankError(data.error || "Failed to unlink bank account.");
        return;
      }
      setBankAccount(null);
    } catch {
      setBankError("An unexpected error occurred. Please try again.");
    } finally {
      setBankUnlinking(false);
    }
  }

  /* ── Profile submit ─────────────────────────────────────── */
  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);

    if (isDemo) {
      setProfileSuccess("Profile updated successfully");
      return;
    }

    setProfileSaving(true);
    try {
      const res = await fetch("/api/portal/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setProfileError(data.error || "Failed to update profile. Please try again.");
        return;
      }

      // Update local state if server returns updated tenant
      if (data.tenant) {
        setProfile(data.tenant);
        setFirstName(data.tenant.firstName);
        setLastName(data.tenant.lastName);
        setPhone(data.tenant.phone || "");
      }

      setProfileSuccess("Profile updated successfully");
    } catch {
      setProfileError("An unexpected error occurred. Please try again.");
    } finally {
      setProfileSaving(false);
    }
  }

  /* ── Password submit ────────────────────────────────────── */
  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    if (isDemo) {
      setPasswordSuccess("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setShowPasswordForm(false);
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await fetch("/api/portal/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setPasswordError(data.error || "Failed to change password. Please try again.");
        return;
      }

      setPasswordSuccess("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setShowPasswordForm(false);
    } catch {
      setPasswordError("An unexpected error occurred. Please try again.");
    } finally {
      setPasswordSaving(false);
    }
  }

  /* ── Loading state ──────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="space-y-8">
      {/* ── Header ──────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your profile, payment methods, and account security.
        </p>
      </div>

      {/* ── Demo banner ─────────────────────────────────────── */}
      {isDemo && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <svg className="h-5 w-5 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-amber-700">
            Showing sample data. Sign in to manage your actual settings.
          </p>
        </div>
      )}

      {/* ── Profile Section ─────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Profile Information</h2>
        </div>
        <form onSubmit={handleProfileSubmit}>
          <div className="space-y-5 p-6">
            {/* Success / Error messages */}
            {profileSuccess && (
              <div className="flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
                <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {profileSuccess}
              </div>
            )}
            {profileError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                {profileError}
              </div>
            )}

            {/* Name fields */}
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                  First name
                </label>
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  autoComplete="given-name"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="John"
                />
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                  Last name
                </label>
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  autoComplete="family-name"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="Doe"
                />
              </div>
            </div>

            {/* Email (read-only) */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                readOnly
                disabled
                value={email}
                className="input-field mt-1.5 bg-gray-50 text-gray-500 cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-gray-400">
                Email cannot be changed. Contact your landlord for assistance.
              </p>
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                Phone number
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="input-field mt-1.5"
                placeholder="(312) 123-4567"
              />
            </div>
          </div>

          {/* Save button */}
          <div className="border-t border-gray-100 bg-gray-50 px-6 py-4 flex justify-end">
            <button
              type="submit"
              disabled={profileSaving}
              className="btn-primary"
            >
              {profileSaving ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </span>
              ) : (
                "Save"
              )}
            </button>
          </div>
        </form>
      </div>

      {/* ── Payment Methods Section ─────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Payment Methods</h2>
        </div>
        <div className="p-6">
          {bankAccount ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                  <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {bankAccount.bankName} ····{bankAccount.last4}
                  </p>
                  <p className="text-xs text-gray-500">Bank account (ACH)</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleLinkBank}
                  disabled={bankLinking}
                  className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {bankLinking ? "Linking..." : "Change"}
                </button>
                <button
                  type="button"
                  onClick={handleUnlinkBank}
                  disabled={bankUnlinking}
                  className="inline-flex items-center rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {bankUnlinking ? "Unlinking..." : "Unlink"}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <svg className="mx-auto h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
              </svg>
              <p className="mt-2 text-sm text-gray-500">No payment method linked</p>
              <button
                type="button"
                onClick={handleLinkBank}
                disabled={bankLinking}
                className="btn-primary mt-4 disabled:opacity-50"
              >
                {bankLinking ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Connecting...
                  </span>
                ) : (
                  "Link Bank Account"
                )}
              </button>
            </div>
          )}

          {/* Bank error */}
          {bankError && (
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <svg className="h-5 w-5 flex-shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <p className="text-sm text-red-700">{bankError}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Account Security Section ────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Account Security</h2>
        </div>
        <div className="p-6">
          {/* Password success (shown when form is collapsed after success) */}
          {passwordSuccess && !showPasswordForm && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
              <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {passwordSuccess}
            </div>
          )}

          {!showPasswordForm ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Password</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Change your account password.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowPasswordForm(true);
                  setPasswordSuccess(null);
                  setPasswordError(null);
                }}
                className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Change Password
              </button>
            </div>
          ) : (
            <form onSubmit={handlePasswordSubmit} className="space-y-5">
              {/* Password error */}
              {passwordError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                  <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  {passwordError}
                </div>
              )}

              {/* Current password */}
              <div>
                <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700">
                  Current password
                </label>
                <input
                  id="currentPassword"
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="Enter current password"
                />
              </div>

              {/* New password */}
              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
                  New password
                </label>
                <input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="At least 8 characters"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Must be at least 8 characters.
                </p>
              </div>

              {/* Confirm new password */}
              <div>
                <label htmlFor="confirmNewPassword" className="block text-sm font-medium text-gray-700">
                  Confirm new password
                </label>
                <input
                  id="confirmNewPassword"
                  name="confirmNewPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className={`input-field mt-1.5 ${confirmNewPassword && newPassword !== confirmNewPassword ? "border-red-300 focus:border-red-500 focus:ring-red-500" : ""}`}
                  placeholder="Re-enter new password"
                />
                {confirmNewPassword && newPassword !== confirmNewPassword && (
                  <p className="mt-1 text-xs text-red-600">Passwords do not match.</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordForm(false);
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmNewPassword("");
                    setPasswordError(null);
                  }}
                  className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={passwordSaving}
                  className="btn-primary"
                >
                  {passwordSaving ? (
                    <span className="flex items-center gap-2">
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Changing...
                    </span>
                  ) : (
                    "Change Password"
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
