import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock sendEmail from shared
const mockSendEmail = vi.fn().mockResolvedValue(true);
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return {
    ...actual,
    sendEmail: (...args: any[]) => mockSendEmail(...args),
  };
});

// Mock prisma
const mockPaymentFindUnique = vi.fn();
vi.mock("../lib/prisma.js", () => ({
  prisma: {
    payment: {
      findUnique: (...args: any[]) => mockPaymentFindUnique(...args),
    },
  },
}));

import {
  sendNotification,
  getSentNotifications,
  clearSentNotifications,
  notifyPaymentFailed,
  notifyPaymentReceived,
} from "../services/notifications.js";

describe("sendNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSentNotifications();
  });

  it("pushes notification to in-memory array", async () => {
    await sendNotification({
      type: "payment_received",
      recipientEmail: "tenant@test.com",
      recipientName: "Test Tenant",
      subject: "Payment received",
      body: "Your payment of $1,500.00 has been received.",
    });

    const sent = getSentNotifications();
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("payment_received");
    expect(sent[0].recipientEmail).toBe("tenant@test.com");
    expect(sent[0].subject).toBe("Payment received");
  });

  it("does NOT call sendEmail in test environment", async () => {
    await sendNotification({
      type: "late_fee_applied",
      recipientEmail: "tenant@test.com",
      recipientName: "Tenant",
      subject: "Late fee applied",
      body: "A late fee has been applied.",
    });

    // In test env, sendEmail should NOT be called
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("accumulates multiple notifications", async () => {
    await sendNotification({
      type: "payment_received",
      recipientEmail: "a@test.com",
      recipientName: "A",
      subject: "Subject 1",
      body: "Body 1",
    });
    await sendNotification({
      type: "payment_failed",
      recipientEmail: "b@test.com",
      recipientName: "B",
      subject: "Subject 2",
      body: "Body 2",
    });

    expect(getSentNotifications()).toHaveLength(2);
  });

  it("clearSentNotifications empties the array", async () => {
    await sendNotification({
      type: "payment_received",
      recipientEmail: "a@test.com",
      recipientName: "A",
      subject: "Test",
      body: "Test",
    });
    expect(getSentNotifications()).toHaveLength(1);

    clearSentNotifications();
    expect(getSentNotifications()).toHaveLength(0);
  });
});

describe("notifyPaymentFailed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSentNotifications();
  });

  it("sends notifications to tenant and landlord", async () => {
    mockPaymentFindUnique.mockResolvedValue({
      id: "pay-1",
      amount: 150000,
      method: "ach",
      leaseId: "lease-1",
      tenant: {
        id: "tenant-1",
        email: "tenant@test.com",
        firstName: "John",
        lastName: "Doe",
      },
      lease: {
        unit: {
          property: {
            name: "Oak Apartments",
            user: {
              email: "landlord@test.com",
              name: "Jane Landlord",
            },
          },
        },
      },
    });

    await notifyPaymentFailed("pay-1");

    const sent = getSentNotifications();
    expect(sent).toHaveLength(2);

    // Tenant notification
    const tenantNotif = sent.find((n) => n.recipientEmail === "tenant@test.com");
    expect(tenantNotif).toBeDefined();
    expect(tenantNotif!.type).toBe("payment_failed");
    expect(tenantNotif!.subject).toContain("$1,500.00");
    expect(tenantNotif!.subject).toContain("failed");

    // Landlord notification
    const landlordNotif = sent.find((n) => n.recipientEmail === "landlord@test.com");
    expect(landlordNotif).toBeDefined();
    expect(landlordNotif!.type).toBe("payment_failed");
    expect(landlordNotif!.subject).toContain("John Doe");
  });

  it("does nothing when payment not found", async () => {
    mockPaymentFindUnique.mockResolvedValue(null);

    await notifyPaymentFailed("nonexistent");

    expect(getSentNotifications()).toHaveLength(0);
  });
});

describe("notifyPaymentReceived", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSentNotifications();
  });

  it("sends notifications to tenant and landlord", async () => {
    mockPaymentFindUnique.mockResolvedValue({
      id: "pay-2",
      amount: 120000,
      method: "card",
      leaseId: "lease-2",
      tenant: {
        id: "tenant-2",
        email: "renter@test.com",
        firstName: "Alice",
        lastName: "Smith",
      },
      lease: {
        unit: {
          property: {
            name: "Elm House",
            user: {
              email: "owner@test.com",
              name: "Bob Owner",
            },
          },
        },
      },
    });

    await notifyPaymentReceived("pay-2");

    const sent = getSentNotifications();
    expect(sent).toHaveLength(2);

    // Tenant notification
    const tenantNotif = sent.find((n) => n.recipientEmail === "renter@test.com");
    expect(tenantNotif).toBeDefined();
    expect(tenantNotif!.type).toBe("payment_received");
    expect(tenantNotif!.subject).toContain("$1,200.00");

    // Landlord notification
    const landlordNotif = sent.find((n) => n.recipientEmail === "owner@test.com");
    expect(landlordNotif).toBeDefined();
    expect(landlordNotif!.subject).toContain("Alice Smith");
  });
});
