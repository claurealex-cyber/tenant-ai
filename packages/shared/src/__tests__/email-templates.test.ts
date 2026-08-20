import { describe, it, expect } from "vitest";
import {
  emailWrapper,
  textToHtml,
  buildPaymentReceivedEmail,
  buildPaymentFailedEmail,
  buildLateFeeAppliedEmail,
  buildNoticeGeneratedEmail,
  buildApplicationCompletedEmail,
  buildDepositReminderEmail,
  buildLeaseExpiringEmail,
  buildOverdueRentEmail,
} from "../email-templates.js";

describe("emailWrapper", () => {
  it("wraps content in branded HTML shell", () => {
    const html = emailWrapper("Test Title", "<p>Hello</p>");
    expect(html).toContain("Tenant AI");
    expect(html).toContain("Test Title");
    expect(html).toContain("<p>Hello</p>");
    expect(html).toContain("Property Management Platform");
  });
});

describe("textToHtml", () => {
  it("converts plain text body to HTML paragraphs", () => {
    const html = textToHtml("Hello World\n\nSecond paragraph", "Test Subject");
    expect(html).toContain("Hello World");
    expect(html).toContain("Second paragraph");
    expect(html).toContain("Test Subject");
    expect(html).toContain("Tenant AI");
  });

  it("converts single newlines to <br>", () => {
    const html = textToHtml("Line 1\nLine 2", "Subject");
    expect(html).toContain("Line 1<br>Line 2");
  });

  it("splits double newlines into separate paragraphs", () => {
    const html = textToHtml("Para 1\n\nPara 2", "Subject");
    // Should contain both paragraphs as separate <p> elements
    expect(html).toContain("Para 1</p>");
    expect(html).toContain("Para 2</p>");
  });
});

describe("buildPaymentReceivedEmail", () => {
  it("builds tenant version with recipient name and amount", () => {
    const html = buildPaymentReceivedEmail({
      recipientName: "John",
      amount: "$1,500.00",
      propertyName: "Oak Apartments",
      paymentMethod: "ach",
      isLandlord: false,
    });
    expect(html).toContain("John");
    expect(html).toContain("$1,500.00");
    expect(html).toContain("Oak Apartments");
    expect(html).toContain("ach");
    expect(html).toContain("Payment Received");
  });

  it("builds landlord version without greeting", () => {
    const html = buildPaymentReceivedEmail({
      recipientName: "Landlord",
      amount: "$1,500.00",
      propertyName: "Oak Apartments",
      paymentMethod: "ach",
      isLandlord: true,
    });
    expect(html).toContain("$1,500.00");
    expect(html).toContain("Oak Apartments");
    expect(html).not.toContain("Hi Landlord");
  });
});

describe("buildPaymentFailedEmail", () => {
  it("builds tenant version with retry instructions", () => {
    const html = buildPaymentFailedEmail({
      recipientName: "Jane",
      amount: "$1,200.00",
      propertyName: "Elm House",
      paymentMethod: "card",
      isLandlord: false,
    });
    expect(html).toContain("Jane");
    expect(html).toContain("$1,200.00");
    expect(html).toContain("Elm House");
    expect(html).toContain("Payment Failed");
    expect(html).toContain("retry");
  });

  it("builds landlord version mentioning tenant notified", () => {
    const html = buildPaymentFailedEmail({
      recipientName: "Owner",
      amount: "$1,200.00",
      propertyName: "Elm House",
      paymentMethod: "card",
      isLandlord: true,
    });
    expect(html).toContain("tenant has been notified");
  });
});

describe("buildLateFeeAppliedEmail", () => {
  it("builds tenant version", () => {
    const html = buildLateFeeAppliedEmail({
      recipientName: "Mike",
      amount: "$50.00",
      propertyName: "Maple Court",
      forMonth: "January 2026",
      isLandlord: false,
    });
    expect(html).toContain("Mike");
    expect(html).toContain("$50.00");
    expect(html).toContain("January 2026");
    expect(html).toContain("Maple Court");
    expect(html).toContain("Late Fee Applied");
  });

  it("builds landlord version with tenant name", () => {
    const html = buildLateFeeAppliedEmail({
      recipientName: "Landlord",
      amount: "$50.00",
      propertyName: "Maple Court",
      forMonth: "January 2026",
      isLandlord: true,
      tenantName: "Mike Payer",
    });
    expect(html).toContain("Mike Payer");
  });
});

describe("buildNoticeGeneratedEmail", () => {
  it("includes notice type, tenant, and property info", () => {
    const html = buildNoticeGeneratedEmail({
      recipientName: "Landlord",
      noticeType: "5-day",
      propertyName: "Oak Apartments",
      unitNumber: "101",
      tenantName: "John Doe",
      isLandlord: true,
    });
    expect(html).toContain("5-day");
    expect(html).toContain("John Doe");
    expect(html).toContain("Oak Apartments");
    expect(html).toContain("Unit 101");
    expect(html).toContain("Notice Generated");
  });

  it("isLandlord true → contains dashboard link, no tenant portal", () => {
    const html = buildNoticeGeneratedEmail({
      recipientName: "Landlord",
      noticeType: "5-day",
      propertyName: "Oak Apartments",
      unitNumber: "101",
      tenantName: "John Doe",
      isLandlord: true,
    });
    expect(html).toContain("your dashboard");
    expect(html).not.toContain("tenant portal");
  });

  it("isLandlord false → greets tenant and links to tenant portal", () => {
    const html = buildNoticeGeneratedEmail({
      recipientName: "Jane Doe",
      noticeType: "10-day",
      propertyName: "Elm House",
      unitNumber: "202",
      tenantName: "Jane Doe",
      isLandlord: false,
    });
    expect(html).toContain("Hi Jane Doe");
    expect(html).toContain("tenant portal");
    expect(html).not.toContain("your dashboard");
  });
});

describe("buildApplicationCompletedEmail", () => {
  it("includes applicant name and property", () => {
    const html = buildApplicationCompletedEmail({
      recipientName: "Landlord",
      applicantName: "Jane Smith",
      propertyName: "Pine Terrace",
    });
    expect(html).toContain("Jane Smith");
    expect(html).toContain("Pine Terrace");
    expect(html).toContain("New Application");
  });
});

describe("buildDepositReminderEmail", () => {
  it("builds warning-level reminder", () => {
    const html = buildDepositReminderEmail({
      recipientName: "Landlord",
      tenantName: "Mike Tenant",
      propertyName: "Oak Apartments",
      unitNumber: "201",
      deadline: "March 15, 2026",
      alertType: "warning",
      daysRemaining: 14,
    });
    expect(html).toContain("Mike Tenant");
    expect(html).toContain("March 15, 2026");
    expect(html).toContain("14 days remaining");
    expect(html).toContain("Deposit Return Reminder");
  });

  it("builds urgent-level reminder with penalty warning", () => {
    const html = buildDepositReminderEmail({
      recipientName: "Landlord",
      tenantName: "Mike Tenant",
      propertyName: "Oak Apartments",
      unitNumber: "201",
      deadline: "March 15, 2026",
      alertType: "urgent",
      daysRemaining: 3,
      penaltyWarning: "Failure to return deposit may result in 2x penalty.",
    });
    expect(html).toContain("3 days remaining");
    expect(html).toContain("2x penalty");
  });
});

describe("buildLeaseExpiringEmail", () => {
  it("builds expiring soon version", () => {
    const html = buildLeaseExpiringEmail({
      recipientName: "Landlord",
      tenantName: "Alex Renter",
      propertyName: "Cedar Place",
      unitNumber: "301",
      expirationDate: "April 1, 2026",
      daysRemaining: 30,
    });
    expect(html).toContain("Alex Renter");
    expect(html).toContain("April 1, 2026");
    expect(html).toContain("30 days remaining");
    expect(html).toContain("Lease Expiring Soon");
  });

  it("builds auto-converted version", () => {
    const html = buildLeaseExpiringEmail({
      recipientName: "Landlord",
      tenantName: "Alex Renter",
      propertyName: "Cedar Place",
      unitNumber: "301",
      expirationDate: "April 1, 2026",
      daysRemaining: 0,
      autoConverted: true,
    });
    expect(html).toContain("month-to-month");
    expect(html).toContain("Lease Converted");
  });
});

describe("buildOverdueRentEmail", () => {
  it("includes amount and days overdue", () => {
    const html = buildOverdueRentEmail({
      recipientName: "Tenant",
      amount: "$1,500.00",
      propertyName: "Oak Apartments",
      daysOverdue: 10,
    });
    expect(html).toContain("Tenant");
    expect(html).toContain("$1,500.00");
    expect(html).toContain("10 days overdue");
    expect(html).toContain("Overdue Rent Notice");
  });

  it("uses singular 'day' for 1 day overdue", () => {
    const html = buildOverdueRentEmail({
      recipientName: "Tenant",
      amount: "$1,000.00",
      propertyName: "Test",
      daysOverdue: 1,
    });
    expect(html).toContain("1 day overdue");
    expect(html).not.toContain("1 days overdue");
  });
});
