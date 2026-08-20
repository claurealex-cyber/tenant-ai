/**
 * HTML email templates for Tenant AI notifications.
 *
 * Two tiers:
 * 1. Rich template builders — used at explicit call sites with structured data
 * 2. textToHtml() — wraps plain-text notification bodies in branded HTML
 */

// ── Shared wrapper ──────────────────────────────────────────────

export function emailWrapper(title: string, content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
  <tr><td style="background:#1e293b;padding:20px 24px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">Tenant AI</h1>
  </td></tr>
  <tr><td style="padding:24px;">
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:18px;">${title}</h2>
    ${content}
  </td></tr>
  <tr><td style="padding:16px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;">
    <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">Tenant AI &mdash; Property Management Platform</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Plain-text to HTML ──────────────────────────────────────────

export function textToHtml(body: string, subject: string): string {
  const paragraphs = body.split("\n\n").map((p) => {
    const lines = p
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("<br>");
    return `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">${lines}</p>`;
  });
  return emailWrapper(subject, paragraphs.join(""));
}

// ── Rich template builders ──────────────────────────────────────

function amountBadge(amount: string, color: string): string {
  return `<span style="display:inline-block;background:${color};color:#ffffff;padding:4px 12px;border-radius:4px;font-weight:600;font-size:16px;">${amount}</span>`;
}

function actionButton(label: string, url?: string): string {
  if (!url) return "";
  return `<p style="margin:20px 0;"><a href="${url}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500;">${label}</a></p>`;
}

// ── Payment Received ────────────────────────────────────────────

interface PaymentReceivedData {
  recipientName: string;
  amount: string;
  propertyName: string;
  paymentMethod: string;
  isLandlord: boolean;
}

export function buildPaymentReceivedEmail(d: PaymentReceivedData): string {
  const content = d.isLandlord
    ? `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">A payment of ${amountBadge(d.amount, "#16a34a")} has been received for <strong>${d.propertyName}</strong>.</p>
       <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Payment method: ${d.paymentMethod}</p>`
    : `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Hi ${d.recipientName},</p>
       <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Your payment of ${amountBadge(d.amount, "#16a34a")} for <strong>${d.propertyName}</strong> has been received.</p>
       <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Payment method: ${d.paymentMethod}</p>
       <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">You can view your receipt in the tenant portal.</p>`;
  return emailWrapper("Payment Received", content);
}

// ── Payment Failed ──────────────────────────────────────────────

interface PaymentFailedData {
  recipientName: string;
  amount: string;
  propertyName: string;
  paymentMethod: string;
  isLandlord: boolean;
}

export function buildPaymentFailedEmail(d: PaymentFailedData): string {
  const content = d.isLandlord
    ? `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">A payment of ${amountBadge(d.amount, "#dc2626")} for <strong>${d.propertyName}</strong> has failed.</p>
       <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Payment method: ${d.paymentMethod}. The tenant has been notified.</p>`
    : `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Hi ${d.recipientName},</p>
       <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Your payment of ${amountBadge(d.amount, "#dc2626")} for <strong>${d.propertyName}</strong> has failed.</p>
       <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Payment method: ${d.paymentMethod}</p>
       <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Please log in to your tenant portal to retry the payment or update your payment method.</p>`;
  return emailWrapper("Payment Failed", content);
}

// ── Late Fee Applied ────────────────────────────────────────────

interface LateFeeAppliedData {
  recipientName: string;
  amount: string;
  propertyName: string;
  forMonth: string;
  isLandlord: boolean;
  tenantName?: string;
}

export function buildLateFeeAppliedEmail(d: LateFeeAppliedData): string {
  const content = d.isLandlord
    ? `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">A late fee of ${amountBadge(d.amount, "#ea580c")} has been applied for ${d.forMonth} rent at <strong>${d.propertyName}</strong>${d.tenantName ? ` for ${d.tenantName}` : ""}.</p>`
    : `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Hi ${d.recipientName},</p>
       <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">A late fee of ${amountBadge(d.amount, "#ea580c")} has been applied for your ${d.forMonth} rent at <strong>${d.propertyName}</strong>.</p>
       <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Please log in to your tenant portal to view your balance and make a payment.</p>`;
  return emailWrapper("Late Fee Applied", content);
}

// ── Notice Generated ────────────────────────────────────────────

interface NoticeGeneratedData {
  recipientName: string;
  noticeType: string;
  propertyName: string;
  unitNumber: string;
  tenantName: string;
  isLandlord: boolean;
}

export function buildNoticeGeneratedEmail(d: NoticeGeneratedData): string {
  const content = d.isLandlord
    ? `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">A ${d.noticeType} notice has been generated for <strong>${d.tenantName}</strong> at ${d.propertyName}, Unit ${d.unitNumber}.</p>
       <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">You can download the notice from your dashboard.</p>`
    : `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Hi ${d.recipientName},</p>
       <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">A ${d.noticeType} notice has been issued for your unit at <strong>${d.propertyName}</strong>, Unit ${d.unitNumber}.</p>
       <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Please log in to your tenant portal to view details.</p>`;
  return emailWrapper("Notice Generated", content);
}

// ── Application Completed ───────────────────────────────────────

interface ApplicationCompletedData {
  recipientName: string;
  applicantName: string;
  propertyName: string;
}

export function buildApplicationCompletedEmail(
  d: ApplicationCompletedData
): string {
  const content = `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">A rental application for <strong>${d.propertyName}</strong> has been completed by <strong>${d.applicantName}</strong>.</p>
    <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Log in to your dashboard to review the application.</p>`;
  return emailWrapper("New Application", content);
}

// ── Deposit Reminder ────────────────────────────────────────────

interface DepositReminderData {
  recipientName: string;
  tenantName: string;
  propertyName: string;
  unitNumber: string;
  deadline: string;
  alertType: "warning" | "urgent";
  daysRemaining: number;
  penaltyWarning?: string;
}

export function buildDepositReminderEmail(d: DepositReminderData): string {
  const urgentColor = d.alertType === "urgent" ? "#dc2626" : "#ea580c";
  const content = `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Security deposit return for <strong>${d.tenantName}</strong> at ${d.propertyName}, Unit ${d.unitNumber} is due by <span style="color:${urgentColor};font-weight:600;">${d.deadline}</span> (${d.daysRemaining} day${d.daysRemaining === 1 ? "" : "s"} remaining).</p>
    ${d.penaltyWarning ? `<p style="margin:0 0 12px;color:${urgentColor};font-size:14px;line-height:1.6;font-weight:600;">${d.penaltyWarning}</p>` : ""}
    <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Log in to your dashboard to process the deposit return.</p>`;
  return emailWrapper("Deposit Return Reminder", content);
}

// ── Lease Expiring ──────────────────────────────────────────────

interface LeaseExpiringData {
  recipientName: string;
  tenantName: string;
  propertyName: string;
  unitNumber: string;
  expirationDate: string;
  daysRemaining: number;
  autoConverted?: boolean;
}

export function buildLeaseExpiringEmail(d: LeaseExpiringData): string {
  const content = d.autoConverted
    ? `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">The lease for <strong>${d.tenantName}</strong> at ${d.propertyName}, Unit ${d.unitNumber} has expired and been automatically converted to a month-to-month lease.</p>`
    : `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">The lease for <strong>${d.tenantName}</strong> at ${d.propertyName}, Unit ${d.unitNumber} expires on <strong>${d.expirationDate}</strong> (${d.daysRemaining} day${d.daysRemaining === 1 ? "" : "s"} remaining).</p>
       <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Log in to your dashboard to renew the lease or take action.</p>`;
  return emailWrapper(
    d.autoConverted ? "Lease Converted to Month-to-Month" : "Lease Expiring Soon",
    content
  );
}

// ── Overdue Rent ────────────────────────────────────────────────

interface OverdueRentData {
  recipientName: string;
  amount: string;
  propertyName: string;
  daysOverdue: number;
}

export function buildOverdueRentEmail(d: OverdueRentData): string {
  const content = `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Hi ${d.recipientName},</p>
    <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Your rent payment of ${amountBadge(d.amount, "#dc2626")} at <strong>${d.propertyName}</strong> is <strong>${d.daysOverdue} day${d.daysOverdue === 1 ? "" : "s"} overdue</strong>.</p>
    <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">Please log in to your tenant portal to make a payment as soon as possible to avoid late fees.</p>`;
  return emailWrapper("Overdue Rent Notice", content);
}
