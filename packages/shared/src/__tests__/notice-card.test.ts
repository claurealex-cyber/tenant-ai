import { describe, it, expect } from "vitest";
import {
  buildNoticeCardSvg,
  renderNoticeCardPng,
  type NoticeCardData,
} from "../notice-card.js";

const baseFiveDay: NoticeCardData = {
  noticeType: "five_day",
  tenantName: "John Smith",
  propertyAddress: "123 Main St, Springfield IL 62701",
  unitNumber: "4B",
  amountOwed: 150000, // $1,500.00
  issueDate: "February 1, 2026",
};

const baseTenDay: NoticeCardData = {
  noticeType: "ten_day",
  tenantName: "Jane Doe",
  propertyAddress: "456 Oak Ave, Chicago IL 60601",
  unitNumber: "12A",
  issueDate: "March 15, 2026",
};

const baseThirtyDay: NoticeCardData = {
  noticeType: "thirty_day",
  tenantName: "Alex Johnson",
  propertyAddress: "789 Elm Blvd, Naperville IL 60540",
  unitNumber: "7",
  issueDate: "April 10, 2026",
};

describe("buildNoticeCardSvg", () => {
  it("returns a string starting with <svg", () => {
    const svg = buildNoticeCardSvg(baseFiveDay);
    expect(svg.trimStart().startsWith("<svg")).toBe(true);
  });

  it("contains the tenant name, property address, unit number, and issue date", () => {
    const svg = buildNoticeCardSvg(baseFiveDay);
    expect(svg).toContain("John Smith");
    expect(svg).toContain("123 Main St, Springfield IL 62701");
    expect(svg).toContain("Unit 4B");
    expect(svg).toContain("February 1, 2026");
  });

  it("escapes XML special characters", () => {
    const data: NoticeCardData = {
      ...baseTenDay,
      tenantName: "Tom & Jerry <LLC>",
      propertyAddress: '456 "Oak" Ave',
    };
    const svg = buildNoticeCardSvg(data);

    expect(svg).toContain("Tom &amp; Jerry &lt;LLC&gt;");
    expect(svg).toContain('456 &quot;Oak&quot; Ave');
    // The raw unescaped versions must NOT appear
    expect(svg).not.toContain("Tom & Jerry <LLC>");
  });

  it("five_day card contains '5-DAY NOTICE' and the amount", () => {
    const svg = buildNoticeCardSvg(baseFiveDay);
    expect(svg).toContain("5-DAY NOTICE");
    expect(svg).toContain("Amount Due:");
    expect(svg).toContain("$1,500.00");
  });

  it("ten_day card contains '10-DAY NOTICE' and amber color", () => {
    const svg = buildNoticeCardSvg(baseTenDay);
    expect(svg).toContain("10-DAY NOTICE");
    expect(svg).toContain("#D97706");
  });

  it("thirty_day card contains '30-DAY NOTICE' and blue color", () => {
    const svg = buildNoticeCardSvg(baseThirtyDay);
    expect(svg).toContain("30-DAY NOTICE");
    expect(svg).toContain("#2563EB");
  });

  it("five_day card shows amount formatted with a dollar sign", () => {
    const data: NoticeCardData = {
      ...baseFiveDay,
      amountOwed: 99999, // $999.99
    };
    const svg = buildNoticeCardSvg(data);
    expect(svg).toContain("$999.99");
  });
});

describe("renderNoticeCardPng", () => {
  it("returns a Buffer starting with PNG magic bytes", async () => {
    const png = await renderNoticeCardPng(baseFiveDay);

    expect(png).toBeInstanceOf(Buffer);
    expect(png.length).toBeGreaterThan(0);

    // PNG magic bytes: 0x89 0x50 0x4E 0x47 (137 80 78 71 decimal)
    expect(png[0]).toBe(137);
    expect(png[1]).toBe(80);
    expect(png[2]).toBe(78);
    expect(png[3]).toBe(71);
  });
});
