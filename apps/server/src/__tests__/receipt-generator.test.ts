import { describe, it, expect } from "vitest";
import {
  generateReceiptPdf,
  formatCents,
  formatMethod,
  formatType,
  type ReceiptData,
} from "../services/receipt-generator.js";

describe("formatCents", () => {
  it("formats 150000 as $1,500.00", () => {
    expect(formatCents(150000)).toBe("$1,500.00");
  });

  it("formats 5000 as $50.00", () => {
    expect(formatCents(5000)).toBe("$50.00");
  });

  it("formats 99 as $0.99", () => {
    expect(formatCents(99)).toBe("$0.99");
  });

  it("formats 0 as $0.00", () => {
    expect(formatCents(0)).toBe("$0.00");
  });

  it("formats 1234567 as $12,345.67", () => {
    expect(formatCents(1234567)).toBe("$12,345.67");
  });
});

describe("formatMethod", () => {
  it("formats ach", () => {
    expect(formatMethod("ach")).toBe("ACH Bank Transfer");
  });

  it("formats card", () => {
    expect(formatMethod("card")).toBe("Credit/Debit Card");
  });

  it("formats cash", () => {
    expect(formatMethod("cash")).toBe("Cash");
  });

  it("formats check", () => {
    expect(formatMethod("check")).toBe("Check");
  });

  it("returns unknown method as-is", () => {
    expect(formatMethod("wire")).toBe("wire");
  });
});

describe("formatType", () => {
  it("formats rent", () => {
    expect(formatType("rent")).toBe("Rent Payment");
  });

  it("formats late_fee", () => {
    expect(formatType("late_fee")).toBe("Late Fee");
  });

  it("formats security_deposit", () => {
    expect(formatType("security_deposit")).toBe("Security Deposit");
  });
});

describe("generateReceiptPdf", () => {
  const sampleData: ReceiptData = {
    date: new Date(2026, 1, 1),
    amountCents: 150000,
    tenantName: "John Smith",
    landlordName: "Acme Properties LLC",
    propertyAddress: "123 Main St, Springfield IL 62701",
    method: "ach",
    type: "rent",
    forMonth: new Date(2026, 1, 1),
    propertyName: "Sunset Apartments",
    unitNumber: "101",
    receiptNumber: "PAY-abc123",
  };

  it("generates a valid PDF buffer", async () => {
    const pdf = await generateReceiptPdf(sampleData);

    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.length).toBeGreaterThan(0);

    // PDF files start with %PDF
    const header = pdf.subarray(0, 5).toString("ascii");
    expect(header).toBe("%PDF-");
  });

  it("generates PDF without optional fields", async () => {
    const minimalData: ReceiptData = {
      date: new Date(2026, 1, 15),
      amountCents: 5000,
      tenantName: "Jane Doe",
      landlordName: "Local Landlord",
      propertyAddress: "456 Oak Ave, Chicago IL 60601",
      method: "cash",
      type: "rent",
      receiptNumber: "PAY-def456",
    };

    const pdf = await generateReceiptPdf(minimalData);

    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.length).toBeGreaterThan(0);

    const header = pdf.subarray(0, 5).toString("ascii");
    expect(header).toBe("%PDF-");
  });

  it("generates PDF for late fee type", async () => {
    const lateFeeData: ReceiptData = {
      ...sampleData,
      type: "late_fee",
      amountCents: 5000,
      receiptNumber: "PAY-late789",
    };

    const pdf = await generateReceiptPdf(lateFeeData);

    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.length).toBeGreaterThan(0);
  });

  it("generates PDF for security deposit", async () => {
    const depositData: ReceiptData = {
      ...sampleData,
      type: "security_deposit",
      amountCents: 225000,
      receiptNumber: "PAY-dep001",
    };

    const pdf = await generateReceiptPdf(depositData);

    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.length).toBeGreaterThan(0);
  });
});
