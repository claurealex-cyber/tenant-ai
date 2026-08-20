import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks (accessible in vi.mock factories) ──

const mockPrisma = vi.hoisted(() => ({
  notice: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  smsOptOut: {
    findUnique: vi.fn(),
  },
}));

const mockGenerateNoticePdf = vi.hoisted(() => vi.fn());
const mockRenderNoticeCardPng = vi.hoisted(() => vi.fn());
const mockSendSms = vi.hoisted(() => vi.fn());
const mockCreateStorageClientFromEnv = vi.hoisted(() => vi.fn());
const mockGetBucketFromEnv = vi.hoisted(() => vi.fn());
const mockUploadFile = vi.hoisted(() => vi.fn());
const mockBuildNoticeSmsPath = vi.hoisted(() => vi.fn());
const mockGenerateDownloadUrl = vi.hoisted(() => vi.fn());

vi.mock("../lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("../lib/notice-pdf", () => ({
  generateNoticePdf: (...args: any[]) => mockGenerateNoticePdf(...args),
}));

vi.mock("@tenant-ai/shared/notice-card", () => ({
  renderNoticeCardPng: (...args: any[]) => mockRenderNoticeCardPng(...args),
}));

vi.mock("@tenant-ai/shared", () => ({
  sendSms: (...args: any[]) => mockSendSms(...args),
  createStorageClientFromEnv: (...args: any[]) =>
    mockCreateStorageClientFromEnv(...args),
  getBucketFromEnv: (...args: any[]) => mockGetBucketFromEnv(...args),
  uploadFile: (...args: any[]) => mockUploadFile(...args),
  buildNoticeSmsPath: (...args: any[]) => mockBuildNoticeSmsPath(...args),
  generateDownloadUrl: (...args: any[]) => mockGenerateDownloadUrl(...args),
}));

import { sendNoticeSms } from "../lib/notice-sms";

// ── Test data ──

const mockNotice = {
  id: "notice-1",
  type: "five_day",
  content: "FIVE-DAY NOTICE...",
  amountOwed: 150000,
  createdAt: new Date("2026-01-15"),
  tenant: { phone: "+13125551234", firstName: "John", lastName: "Doe" },
  lease: {
    unit: {
      unitNumber: "101",
      property: {
        id: "prop-1",
        name: "Oak Apartments",
        address: "123 Oak St",
        userId: "user-1",
        twilioPhone: "+13125559999",
      },
    },
  },
};

describe("sendNoticeSms", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default happy-path mocks
    mockPrisma.notice.findUnique.mockResolvedValue(mockNotice);
    mockPrisma.smsOptOut.findUnique.mockResolvedValue(null);
    mockPrisma.notice.update.mockResolvedValue({});

    mockGenerateNoticePdf.mockResolvedValue(Buffer.from("fake-pdf"));
    mockRenderNoticeCardPng.mockResolvedValue(Buffer.from("fake-png"));

    mockCreateStorageClientFromEnv.mockReturnValue({});
    mockGetBucketFromEnv.mockReturnValue("test-bucket");
    mockBuildNoticeSmsPath.mockImplementation(
      (_userId: string, _noticeId: string, filename: string) =>
        `notices/${_userId}/${_noticeId}/${filename}`
    );
    mockUploadFile.mockResolvedValue(undefined);
    mockGenerateDownloadUrl.mockResolvedValue({
      downloadUrl: "https://s3.example.com/card.png",
      expiresIn: 14400,
    });

    mockSendSms.mockResolvedValue({ success: true, sid: "SM123" });
  });

  it("sends SMS and updates notice on success", async () => {
    const result = await sendNoticeSms("notice-1");

    expect(result).toEqual({ success: true, sid: "SM123" });

    // Verify notice was loaded
    expect(mockPrisma.notice.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "notice-1" } })
    );

    // Verify opt-out check
    expect(mockPrisma.smsOptOut.findUnique).toHaveBeenCalledWith({
      where: {
        phone_propertyId: {
          phone: "+13125551234",
          propertyId: "prop-1",
        },
      },
    });

    // Verify PDF generation
    expect(mockGenerateNoticePdf).toHaveBeenCalledWith("FIVE-DAY NOTICE...");

    // Verify PNG card generation
    expect(mockRenderNoticeCardPng).toHaveBeenCalledWith(
      expect.objectContaining({
        noticeType: "five_day",
        tenantName: "John Doe",
        propertyAddress: "123 Oak St",
        unitNumber: "101",
        amountOwed: 150000,
      })
    );

    // Verify S3 uploads
    expect(mockUploadFile).toHaveBeenCalledTimes(2);
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.anything(),
      "test-bucket",
      expect.stringContaining("card.png"),
      Buffer.from("fake-png"),
      "image/png"
    );
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.anything(),
      "test-bucket",
      expect.stringContaining("notice.pdf"),
      Buffer.from("fake-pdf"),
      "application/pdf"
    );

    // Verify pre-signed URL generation
    expect(mockGenerateDownloadUrl).toHaveBeenCalledTimes(2);

    // Verify sendSms was called with correct params
    expect(mockSendSms).toHaveBeenCalledWith({
      to: "+13125551234",
      from: "+13125559999",
      body: expect.stringContaining("LEGAL NOTICE"),
      mediaUrls: expect.arrayContaining([
        "https://s3.example.com/card.png",
      ]),
    });

    // Verify notice updated with SMS tracking
    expect(mockPrisma.notice.update).toHaveBeenCalledWith({
      where: { id: "notice-1" },
      data: {
        smsSentAt: expect.any(Date),
        smsTo: "+13125551234",
        smsSid: "SM123",
      },
    });
  });

  it("returns error when notice is not found", async () => {
    mockPrisma.notice.findUnique.mockResolvedValue(null);

    const result = await sendNoticeSms("nonexistent");

    expect(result).toEqual({ success: false, error: "Notice not found" });
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockPrisma.notice.update).not.toHaveBeenCalled();
  });

  it("returns error when tenant has no phone", async () => {
    mockPrisma.notice.findUnique.mockResolvedValue({
      ...mockNotice,
      tenant: { ...mockNotice.tenant, phone: null },
    });

    const result = await sendNoticeSms("notice-1");

    expect(result).toEqual({
      success: false,
      error: "Tenant has no phone number on file",
    });
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockPrisma.notice.update).not.toHaveBeenCalled();
  });

  it("returns error when property has no Twilio phone", async () => {
    mockPrisma.notice.findUnique.mockResolvedValue({
      ...mockNotice,
      lease: {
        unit: {
          ...mockNotice.lease.unit,
          property: {
            ...mockNotice.lease.unit.property,
            twilioPhone: null,
          },
        },
      },
    });

    const result = await sendNoticeSms("notice-1");

    expect(result).toEqual({
      success: false,
      error: "Property has no Twilio phone number",
    });
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockPrisma.notice.update).not.toHaveBeenCalled();
  });

  it("returns error when tenant has opted out of SMS", async () => {
    mockPrisma.smsOptOut.findUnique.mockResolvedValue({
      id: "opt-1",
      phone: "+13125551234",
      propertyId: "prop-1",
      createdAt: new Date(),
    });

    const result = await sendNoticeSms("notice-1");

    expect(result).toEqual({
      success: false,
      error: "Tenant has opted out of SMS",
    });
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockPrisma.notice.update).not.toHaveBeenCalled();
  });

  it("returns error when sendSms fails", async () => {
    mockSendSms.mockResolvedValue({
      success: false,
      error: "Twilio API error: invalid number",
    });

    const result = await sendNoticeSms("notice-1");

    expect(result).toEqual({
      success: false,
      error: "Twilio API error: invalid number",
    });
    // SMS was attempted
    expect(mockSendSms).toHaveBeenCalled();
    // But notice should NOT be updated on failure
    expect(mockPrisma.notice.update).not.toHaveBeenCalled();
  });
});
