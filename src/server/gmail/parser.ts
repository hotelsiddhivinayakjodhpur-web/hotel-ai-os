import type {
  IngestInput,
  ParsedDailyIntelligence,
  ParsedNightAudit,
  PerformanceBlock,
  StayflexiReportType,
} from "./types";

/**
 * Stayflexi report parser. Turns a raw email (HTML body + optional attachment
 * text) into structured metrics. Built against the REAL Stayflexi Night Audit
 * email format — no values are hardcoded; everything is extracted by label.
 *
 * Strategy:
 *  - Night Audit core KPIs (rooms sold, occupancy, ADR, room revenue, payments,
 *    month-to-date) are present in the EMAIL HTML BODY → parsed from there
 *    (reliable, no PDF binary needed). RevPAR + rooms available are derived.
 *  - Extended detail (revenue by source/room type, pickup, forecast, arrivals/
 *    departures) lives in the attached PDFs → parsed from extracted PDF text
 *    when provided (best-effort, label-based, degrades gracefully).
 */

// ── text utilities ────────────────────────────────────────────────────────────
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse a money/number token like "Rs. 1,064.09" or "-150.0" → number. */
function toNumber(token: string | undefined | null): number | null {
  if (!token) return null;
  const cleaned = token.replace(/rs\.?/i, "").replace(/,/g, "").trim();
  const m = /-?\d+(\.\d+)?/.exec(cleaned);
  return m ? Number(m[0]) : null;
}

/** First integer after a label. */
function intAfter(text: string, label: string): number | null {
  const re = new RegExp(`${escape(label)}\\s*:?\\s*(-?[\\d,]+)`, "i");
  const m = re.exec(text);
  return m ? toNumber(m[1]) : null;
}

/** First money value after a label (expects an "Rs." nearby but tolerant). */
function moneyAfter(text: string, label: string): number | null {
  const re = new RegExp(`${escape(label)}\\s*:?\\s*(?:rs\\.?\\s*)?(-?[\\d,]+(?:\\.\\d+)?)`, "i");
  const m = re.exec(text);
  return m ? toNumber(m[1]) : null;
}

/** Percentage after a label → ratio 0-1. Handles "73.08%" and "77.95 %". */
function pctAfter(text: string, label: string): number | null {
  const re = new RegExp(`${escape(label)}\\s*:?\\s*([\\d.]+)\\s*%`, "i");
  const m = re.exec(text);
  return m ? Number(m[1]) / 100 : null;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parse a date like "Jun 15 2026" or "Jun 15, 2026" → "YYYY-MM-DD". */
export function parseReportDate(text: string): string | null {
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (!m) return null;
  const mon = MONTHS[m[1]!.toLowerCase()];
  if (!mon) return null;
  const d = Number(m[2]);
  const y = Number(m[3]);
  return `${y}-${String(mon).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ── report-type detection ─────────────────────────────────────────────────────
export function detectReportType(input: {
  subject?: string;
  from?: string;
  filename?: string;
  body?: string;
}): StayflexiReportType {
  const hay = `${input.subject ?? ""} ${input.filename ?? ""} ${input.body ?? ""}`.toLowerCase();
  if (/night\s*audit|auditreport/.test(hay)) return "NIGHT_AUDIT";
  if (/daily\s*intelligence/.test(hay)) return "DAILY_INTELLIGENCE";
  return "UNKNOWN";
}

// ── Night Audit (email HTML body) ─────────────────────────────────────────────
function parsePerformance(segment: string): PerformanceBlock {
  const roomsSold = intAfter(segment, "Rooms sold");
  const occupancy = pctAfter(segment, "Occupancy");
  const adr = moneyAfter(segment, "ADR");
  const roomRevenue = moneyAfter(segment, "Room revenue");
  const posRevenue = moneyAfter(segment, "POS revenue");
  const servicesRevenue = moneyAfter(segment, "Services revenue");
  const totalPayments = moneyAfter(segment, "Total");

  // Derived: RevPAR = ADR × occupancy; rooms available = sold / occupancy.
  const revpar = adr !== null && occupancy !== null ? Number((adr * occupancy).toFixed(2)) : null;
  const roomsAvailable =
    roomsSold !== null && occupancy && occupancy > 0 ? Math.round(roomsSold / occupancy) : null;

  return { roomsSold, roomsAvailable, occupancy, adr, revpar, roomRevenue, posRevenue, servicesRevenue, totalPayments };
}

const PAYMENT_LABELS = [
  "Bank Transfer Payment",
  "Cash Payment Refunds",
  "Cash Payment",
  "Offline Card Payment",
  "Offline Check Payment",
  "UPI Payment Refunds",
  "UPI Payment",
  "Other Source Payment",
  "Payment gateway refunds",
];

function parsePayments(segment: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const label of PAYMENT_LABELS) {
    const v = moneyAfter(segment, label);
    if (v !== null) out[label] = v;
  }
  return out;
}

export function parseNightAuditEmail(text: string): ParsedNightAudit {
  // Split today vs month-to-date on the "Month's performance" marker.
  const monthIdx = text.search(/month'?s performance/i);
  const todaySeg = monthIdx >= 0 ? text.slice(0, monthIdx) : text;
  const monthSeg = monthIdx >= 0 ? text.slice(monthIdx) : "";

  const today = parsePerformance(todaySeg);
  const monthToDate = monthSeg ? parsePerformance(monthSeg) : emptyBlock();
  const payments = parsePayments(todaySeg);

  const businessDate = parseReportDate(text);
  const arrivals = intAfter(text, "Arrivals");
  const departures = intAfter(text, "Departures");

  const fieldsParsed =
    Object.values(today).filter((v) => v !== null).length + Object.keys(payments).length;

  return { reportType: "NIGHT_AUDIT", businessDate, today, monthToDate, payments, arrivals, departures, fieldsParsed };
}

function emptyBlock(): PerformanceBlock {
  return {
    roomsSold: null, roomsAvailable: null, occupancy: null, adr: null, revpar: null,
    roomRevenue: null, posRevenue: null, servicesRevenue: null, totalPayments: null,
  };
}

// ── Daily Intelligence (PDF text, best-effort) ────────────────────────────────
export function parseDailyIntelligence(text: string): ParsedDailyIntelligence {
  const occupancy = pctAfter(text, "Occupancy");
  const revenue = moneyAfter(text, "Revenue");
  const pickup = moneyAfter(text, "Pickup");
  const bookingWindow = intAfter(text, "Booking Window");

  // "Source  Amount" style rows for revenue/pickup by source.
  const revenueBySource = extractSourceAmounts(text, /revenue by source([\s\S]{0,800}?)(?:pickup by source|revenue by room|market intelligence|$)/i);
  const pickupBySource = extractSourceAmounts(text, /pickup by source([\s\S]{0,800}?)(?:revenue by room|market intelligence|$)/i).map((r) => ({
    source: r.source,
    rooms: null,
    revenue: r.amount,
  }));
  const revenueByRoomType = extractSourceAmounts(text, /revenue by room type([\s\S]{0,800}?)(?:market intelligence|pickup|$)/i).map((r) => ({
    roomType: r.source,
    revenue: r.amount,
    roomsSold: null,
  }));

  const fieldsParsed =
    [occupancy, revenue, pickup, bookingWindow].filter((v) => v !== null).length +
    revenueBySource.length + pickupBySource.length + revenueByRoomType.length;

  return {
    reportType: "DAILY_INTELLIGENCE",
    businessDate: parseReportDate(text),
    occupancy,
    revenue,
    pickup,
    bookingWindow,
    revenueBySource,
    revenueByRoomType,
    pickupBySource,
    marketIntel: null,
    fieldsParsed,
  };
}

/** Pull "<name> Rs. <amount>" pairs from a bounded section. */
function extractSourceAmounts(text: string, sectionRe: RegExp): { source: string; amount: number }[] {
  const section = sectionRe.exec(text)?.[1];
  if (!section) return [];
  const out: { source: string; amount: number }[] = [];
  const re = /([A-Za-z][A-Za-z0-9 .&/_-]{1,40}?)\s*(?:rs\.?\s*)?(-?[\d,]+(?:\.\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    const source = m[1]!.trim();
    const amount = toNumber(m[2]);
    if (amount !== null && source.length > 1) out.push({ source, amount });
  }
  return out;
}

// ── top-level dispatch ────────────────────────────────────────────────────────
/**
 * Parse an ingest input into a structured report. Prefers the email HTML for
 * Night Audit; uses attachment text for Daily Intelligence / PDF detail.
 */
export function parseIngest(input: IngestInput): {
  type: StayflexiReportType;
  nightAudit?: ParsedNightAudit;
  dailyIntelligence?: ParsedDailyIntelligence;
} {
  const bodyText = input.html ? htmlToText(input.html) : (input.text ?? "");
  const attachmentText = (input.attachments ?? []).map((a) => a.text).join("\n");
  const combined = `${bodyText}\n${attachmentText}`;

  const type = detectReportType({ subject: input.subject, from: input.from, body: combined });

  const result: ReturnType<typeof parseIngest> = { type };

  // Night Audit: parse from the email body (core KPIs live there).
  if (type === "NIGHT_AUDIT" || /rooms sold/i.test(bodyText)) {
    result.nightAudit = parseNightAuditEmail(bodyText || combined);
  }
  // Daily Intelligence: from the dedicated attachment text if present.
  const diText = (input.attachments ?? []).find((a) => /daily intelligence/i.test(a.filename))?.text;
  if (diText) {
    result.dailyIntelligence = parseDailyIntelligence(diText);
  }
  return result;
}
