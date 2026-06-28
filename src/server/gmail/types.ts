/**
 * Types for the Gmail Intelligence layer. These describe the PARSED shape of
 * Stayflexi's daily emails — deliberately source-agnostic so the same structures
 * are produced whether the data came from Gmail (now) or the Stayflexi API
 * (later). The AI layer only ever sees these + the normalized KpiSet.
 */
export type StayflexiReportType = "NIGHT_AUDIT" | "DAILY_INTELLIGENCE" | "UNKNOWN";

export interface PerformanceBlock {
  roomsSold: number | null;
  roomsAvailable: number | null;
  occupancy: number | null; // 0-1
  adr: number | null;
  revpar: number | null;
  roomRevenue: number | null;
  posRevenue: number | null;
  servicesRevenue: number | null;
  totalPayments: number | null;
}

export interface ParsedNightAudit {
  reportType: "NIGHT_AUDIT";
  businessDate: string | null; // YYYY-MM-DD
  today: PerformanceBlock;
  monthToDate: PerformanceBlock;
  payments: Record<string, number>;
  arrivals: number | null;
  departures: number | null;
  fieldsParsed: number;
}

export interface ParsedDailyIntelligence {
  reportType: "DAILY_INTELLIGENCE";
  businessDate: string | null;
  occupancy: number | null;
  revenue: number | null;
  pickup: number | null;
  bookingWindow: number | null;
  revenueBySource: { source: string; amount: number }[];
  revenueByRoomType: { roomType: string; revenue: number; roomsSold: number | null }[];
  pickupBySource: { source: string; rooms: number | null; revenue: number | null }[];
  marketIntel: Record<string, unknown> | null;
  fieldsParsed: number;
}

export type ParsedReport = ParsedNightAudit | ParsedDailyIntelligence;

export interface IngestInput {
  /** Gmail message id (provenance + idempotency). */
  messageId?: string;
  subject?: string;
  from?: string;
  /** Raw email HTML body (primary source for Night Audit core KPIs). */
  html?: string;
  /** Plain text body, if available. */
  text?: string;
  /** Extracted text of attachments, keyed by filename (for PDF detail). */
  attachments?: { filename: string; text: string }[];
  /** Override the source label (defaults to "gmail"). */
  source?: string;
}
