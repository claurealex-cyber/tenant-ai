/**
 * Notice summary card generator.
 * Builds an SVG summary card for notice SMS/MMS delivery,
 * then renders it to PNG via @resvg/resvg-js.
 */

export interface NoticeCardData {
  noticeType: "five_day" | "ten_day" | "thirty_day";
  tenantName: string;
  propertyAddress: string;
  unitNumber: string;
  amountOwed?: number; // cents, only for five_day
  issueDate: string; // formatted date string
}

const TYPE_CONFIG: Record<
  string,
  { label: string; subtitle: string; color: string }
> = {
  five_day: {
    label: "5-DAY NOTICE",
    subtitle: "Demand for Payment of Rent",
    color: "#DC2626", // red-600
  },
  ten_day: {
    label: "10-DAY NOTICE",
    subtitle: "Notice to Quit for Lease Violation",
    color: "#D97706", // amber-600
  },
  thirty_day: {
    label: "30-DAY NOTICE",
    subtitle: "Notice of Termination of Tenancy",
    color: "#2563EB", // blue-600
  },
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildNoticeCardSvg(data: NoticeCardData): string {
  const config = TYPE_CONFIG[data.noticeType] ?? TYPE_CONFIG.five_day;
  const escapedTenant = escapeXml(data.tenantName);
  const escapedAddress = escapeXml(data.propertyAddress);
  const escapedUnit = escapeXml(data.unitNumber);
  const escapedDate = escapeXml(data.issueDate);

  const amountLine =
    data.noticeType === "five_day" && data.amountOwed !== undefined
      ? `<text x="40" y="228" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#1E293B">Amount Due: <tspan font-weight="bold" fill="${config.color}">$${(data.amountOwed / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</tspan></text>`
      : "";

  const dateY = amountLine ? 262 : 228;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340">
  <defs>
    <clipPath id="roundedCard">
      <rect width="600" height="340" rx="12" ry="12"/>
    </clipPath>
  </defs>
  <g clip-path="url(#roundedCard)">
    <!-- Background -->
    <rect width="600" height="340" fill="#FFFFFF"/>
    <!-- Colored header -->
    <rect width="600" height="90" fill="${config.color}"/>
    <!-- Notice type -->
    <text x="40" y="42" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="bold" fill="#FFFFFF">${escapeXml(config.label)}</text>
    <text x="40" y="70" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="rgba(255,255,255,0.9)">${escapeXml(config.subtitle)}</text>
    <!-- Tenant name -->
    <text x="40" y="130" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#64748B">TENANT</text>
    <text x="40" y="155" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="bold" fill="#1E293B">${escapedTenant}</text>
    <!-- Property -->
    <text x="40" y="190" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#64748B">PROPERTY</text>
    <text x="40" y="210" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#1E293B">${escapedAddress}, Unit ${escapedUnit}</text>
    <!-- Amount (5-day only) -->
    ${amountLine}
    <!-- Date -->
    <text x="40" y="${dateY}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#64748B">ISSUED</text>
    <text x="40" y="${dateY + 20}" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#1E293B">${escapedDate}</text>
    <!-- Footer -->
    <rect y="305" width="600" height="35" fill="#F8FAFC"/>
    <text x="560" y="327" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#94A3B8" text-anchor="end">Tenant AI</text>
  </g>
  <!-- Border -->
  <rect width="600" height="340" rx="12" ry="12" fill="none" stroke="#E2E8F0" stroke-width="1"/>
</svg>`;
}

export async function renderNoticeCardPng(
  data: NoticeCardData
): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");
  const svg = buildNoticeCardSvg(data);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 600 },
  });
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}
