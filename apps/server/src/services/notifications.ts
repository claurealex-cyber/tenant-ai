/**
 * Notification service — queues and dispatches email/in-app notifications.
 *
 * Sends HTML-wrapped emails via SendGrid (or dev console fallback).
 * All dispatches are best-effort — failures are logged but never break callers.
 */

import { prisma } from "../lib/prisma.js";
import { sendEmail, textToHtml } from "@tenant-ai/shared";

// ── Types ──

export type NotificationType =
  | "payment_failed"
  | "payment_received"
  | "late_fee_applied"
  | "notice_generated"
  | "application_completed"
  | "deposit_reminder"
  | "lease_expiring"
  | "overdue_rent"
  | "tour_booked"
  | "tour_canceled"
  | "maintenance_submitted"
  | "maintenance_updated";

export interface Notification {
  type: NotificationType;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
}

// ── In-memory log for testing / pre-email-integration ──

const sentNotifications: Notification[] = [];

/**
 * Send a notification. Logs to in-memory array (for test assertions) and
 * dispatches an HTML email via SendGrid (skipped in test environment).
 */
export async function sendNotification(n: Notification): Promise<void> {
  sentNotifications.push(n);

  if (process.env.NODE_ENV !== "test") {
    try {
      const html = textToHtml(n.body, n.subject);
      await sendEmail({ to: n.recipientEmail, subject: n.subject, html });
    } catch (err) {
      console.error(
        `[notification] Email dispatch failed for ${n.type} → ${n.recipientEmail}:`,
        err
      );
    }
    console.log(
      `[notification] ${n.type} → ${n.recipientEmail}: ${n.subject}`
    );
  }
}

/**
 * Notify tenant and landlord when an ACH/card payment fails.
 */
export async function notifyPaymentFailed(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      tenant: true,
      lease: {
        include: {
          unit: {
            include: {
              property: {
                include: { user: true },
              },
            },
          },
        },
      },
    },
  });

  if (!payment) return;

  const tenant = payment.tenant;
  const landlord = payment.lease.unit.property.user;
  const property = payment.lease.unit.property;
  const amountStr = `$${(payment.amount / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Notify tenant
  await sendNotification({
    type: "payment_failed",
    recipientEmail: tenant.email,
    recipientName: `${tenant.firstName} ${tenant.lastName}`,
    subject: `Your payment of ${amountStr} failed`,
    body: [
      `Hi ${tenant.firstName},`,
      "",
      `Your ${payment.method.toUpperCase()} payment of ${amountStr} for ${property.name} could not be processed.`,
      "",
      "Please log in to your tenant portal and try again with a different payment method.",
      "",
      "If you have questions, contact your landlord.",
    ].join("\n"),
    metadata: { paymentId: payment.id, leaseId: payment.leaseId },
  });

  // Notify landlord
  await sendNotification({
    type: "payment_failed",
    recipientEmail: landlord.email,
    recipientName: landlord.name || landlord.email,
    subject: `Payment from ${tenant.firstName} ${tenant.lastName} failed`,
    body: [
      `A payment of ${amountStr} from ${tenant.firstName} ${tenant.lastName} for ${property.name} has failed.`,
      "",
      `Payment method: ${payment.method.toUpperCase()}`,
      `Tenant email: ${tenant.email}`,
      "",
      "The tenant has been notified. No automatic retry will be attempted.",
    ].join("\n"),
    metadata: { paymentId: payment.id, tenantId: tenant.id },
  });
}

/**
 * Notify tenant when a payment is received.
 */
export async function notifyPaymentReceived(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      tenant: true,
      lease: {
        include: {
          unit: {
            include: {
              property: {
                include: { user: true },
              },
            },
          },
        },
      },
    },
  });

  if (!payment) return;

  const tenant = payment.tenant;
  const landlord = payment.lease.unit.property.user;
  const property = payment.lease.unit.property;
  const amountStr = `$${(payment.amount / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Notify tenant
  await sendNotification({
    type: "payment_received",
    recipientEmail: tenant.email,
    recipientName: `${tenant.firstName} ${tenant.lastName}`,
    subject: `Payment of ${amountStr} received`,
    body: [
      `Hi ${tenant.firstName},`,
      "",
      `Your payment of ${amountStr} for ${property.name} has been received.`,
      "",
      "A receipt is available in your tenant portal.",
    ].join("\n"),
    metadata: { paymentId: payment.id },
  });

  // Notify landlord
  await sendNotification({
    type: "payment_received",
    recipientEmail: landlord.email,
    recipientName: landlord.name || landlord.email,
    subject: `Payment received from ${tenant.firstName} ${tenant.lastName}`,
    body: [
      `A payment of ${amountStr} from ${tenant.firstName} ${tenant.lastName} for ${property.name} has been received.`,
      "",
      `Payment method: ${payment.method.toUpperCase()}`,
    ].join("\n"),
    metadata: { paymentId: payment.id, tenantId: tenant.id },
  });
}

// ── Test helpers ──

export function getSentNotifications(): Notification[] {
  return [...sentNotifications];
}

export function clearSentNotifications(): void {
  sentNotifications.length = 0;
}
