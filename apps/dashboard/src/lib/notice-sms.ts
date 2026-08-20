import { prisma } from "./prisma";
import { generateNoticePdf } from "./notice-pdf";
import {
  sendSms,
  createStorageClientFromEnv,
  getBucketFromEnv,
  uploadFile,
  buildNoticeSmsPath,
  generateDownloadUrl,
} from "@tenant-ai/shared";
import { renderNoticeCardPng } from "@tenant-ai/shared/notice-card";
import type { NoticeCardData } from "@tenant-ai/shared/notice-card";

export interface NoticeSmsResult {
  success: boolean;
  sid?: string;
  error?: string;
}

const TYPE_LABELS: Record<string, string> = {
  five_day: "5-Day",
  ten_day: "10-Day",
  thirty_day: "30-Day",
};

export async function sendNoticeSms(
  noticeId: string
): Promise<NoticeSmsResult> {
  // 1. Load notice with relations
  const notice = await prisma.notice.findUnique({
    where: { id: noticeId },
    include: {
      tenant: {
        select: {
          phone: true,
          firstName: true,
          lastName: true,
        },
      },
      lease: {
        include: {
          unit: {
            include: {
              property: {
                select: {
                  id: true,
                  name: true,
                  address: true,
                  userId: true,
                  twilioPhone: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!notice) {
    return { success: false, error: "Notice not found" };
  }

  // 2. Validate
  const tenant = notice.tenant;
  const property = notice.lease.unit.property;

  if (!tenant.phone) {
    return { success: false, error: "Tenant has no phone number on file" };
  }

  if (!property.twilioPhone) {
    return { success: false, error: "Property has no Twilio phone number" };
  }

  // Check opt-out
  const optOut = await prisma.smsOptOut.findUnique({
    where: {
      phone_propertyId: {
        phone: tenant.phone,
        propertyId: property.id,
      },
    },
  });
  if (optOut) {
    return { success: false, error: "Tenant has opted out of SMS" };
  }

  // 3. Generate PDF
  const pdfBuffer = await generateNoticePdf(notice.content);

  // 4. Generate PNG summary card
  const typeLabel = TYPE_LABELS[notice.type] || notice.type;
  const cardData: NoticeCardData = {
    noticeType: notice.type as NoticeCardData["noticeType"],
    tenantName: `${tenant.firstName} ${tenant.lastName}`,
    propertyAddress: property.address,
    unitNumber: notice.lease.unit.unitNumber,
    amountOwed: notice.amountOwed ?? undefined,
    issueDate: notice.createdAt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };
  const pngBuffer = await renderNoticeCardPng(cardData);

  // 5. Upload to S3
  const s3Client = createStorageClientFromEnv();
  const bucket = getBucketFromEnv();
  const userId = property.userId;

  const pngKey = buildNoticeSmsPath(userId, noticeId, "card.png");
  const pdfKey = buildNoticeSmsPath(userId, noticeId, "notice.pdf");

  await uploadFile(s3Client, bucket, pngKey, pngBuffer, "image/png");
  await uploadFile(s3Client, bucket, pdfKey, pdfBuffer, "application/pdf");

  // 6. Generate pre-signed download URLs (4-hour TTL for Twilio async fetch)
  const [pngResult, pdfResult] = await Promise.all([
    generateDownloadUrl(s3Client, bucket, pngKey, 14400),
    generateDownloadUrl(s3Client, bucket, pdfKey, 14400),
  ]);

  // 7. Build SMS body
  const tenantSiteUrl =
    process.env.TENANT_SITE_URL || "http://localhost:3002";
  let smsBody = `⚠️ LEGAL NOTICE - ${property.name}\n\nYou have received a ${typeLabel} notice for ${property.address}, Unit ${notice.lease.unit.unitNumber}.`;

  if (notice.type === "five_day" && notice.amountOwed) {
    const fmtAmount = (notice.amountOwed / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    smsBody += `\n\nAmount owed: $${fmtAmount}`;
  }

  smsBody += `\n\nView details: ${tenantSiteUrl}/portal/notices`;
  smsBody += `\n\nReply STOP to opt out of SMS notifications.`;

  // 8. Send SMS/MMS
  const smsResult = await sendSms({
    to: tenant.phone,
    from: property.twilioPhone,
    body: smsBody,
    mediaUrls: [pngResult.downloadUrl, pdfResult.downloadUrl],
  });

  if (!smsResult.success) {
    return { success: false, error: smsResult.error };
  }

  // 9. Update notice with SMS tracking
  await prisma.notice.update({
    where: { id: noticeId },
    data: {
      smsSentAt: new Date(),
      smsTo: tenant.phone,
      smsSid: smsResult.sid,
    },
  });

  return { success: true, sid: smsResult.sid };
}
