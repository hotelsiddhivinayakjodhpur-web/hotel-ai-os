import { prisma } from "@/lib/prisma";
import type { EmailProcessingStatus, Prisma } from "@prisma/client";

/**
 * Data access for the Gmail Intelligence layer (parsed Stayflexi reports +
 * processing logs). All persistence for the pipeline funnels through here.
 */
export const reportRepository = {
  upsertNightAudit(
    hotelId: string,
    businessDate: Date,
    data: Omit<Prisma.NightAuditReportUncheckedCreateInput, "hotelId" | "businessDate">,
  ) {
    return prisma.nightAuditReport.upsert({
      where: { hotelId_businessDate: { hotelId, businessDate } },
      create: { hotelId, businessDate, ...data },
      update: { ...data },
    });
  },

  upsertDailyIntelligence(
    hotelId: string,
    businessDate: Date,
    data: Omit<Prisma.DailyIntelligenceReportUncheckedCreateInput, "hotelId" | "businessDate">,
  ) {
    return prisma.dailyIntelligenceReport.upsert({
      where: { hotelId_businessDate: { hotelId, businessDate } },
      create: { hotelId, businessDate, ...data },
      update: { ...data },
    });
  },

  /** Replace the revenue-by-source rows for a night-audit report. */
  async replaceRevenueSources(
    nightAuditId: string,
    hotelId: string,
    businessDate: Date,
    rows: { source: string; amount: number; scope?: string }[],
  ) {
    await prisma.revenueSource.deleteMany({ where: { nightAuditId } });
    if (rows.length === 0) return;
    await prisma.revenueSource.createMany({
      data: rows.map((r) => ({ nightAuditId, hotelId, businessDate, source: r.source, amount: r.amount, scope: r.scope ?? "today" })),
    });
  },

  async replaceRoomRevenues(
    nightAuditId: string,
    hotelId: string,
    businessDate: Date,
    rows: { roomType: string; revenue: number | null; roomsSold: number | null }[],
  ) {
    await prisma.roomRevenue.deleteMany({ where: { nightAuditId } });
    if (rows.length === 0) return;
    await prisma.roomRevenue.createMany({
      data: rows.map((r) => ({ nightAuditId, hotelId, businessDate, roomType: r.roomType, revenue: r.revenue, roomsSold: r.roomsSold })),
    });
  },

  async replacePickupSources(
    dailyReportId: string,
    hotelId: string,
    businessDate: Date,
    rows: { source: string; rooms: number | null; revenue: number | null }[],
  ) {
    await prisma.pickupSource.deleteMany({ where: { dailyReportId } });
    if (rows.length === 0) return;
    await prisma.pickupSource.createMany({
      data: rows.map((r) => ({ dailyReportId, hotelId, businessDate, source: r.source, rooms: r.rooms, revenue: r.revenue })),
    });
  },

  // ── reads (used by the data provider) ──
  latestNightAudit(hotelId: string) {
    return prisma.nightAuditReport.findFirst({ where: { hotelId }, orderBy: { businessDate: "desc" } });
  },
  nightAuditFor(hotelId: string, businessDate: Date) {
    return prisma.nightAuditReport.findUnique({ where: { hotelId_businessDate: { hotelId, businessDate } } });
  },
  nightAuditsBetween(hotelId: string, from: Date, to: Date) {
    return prisma.nightAuditReport.findMany({
      where: { hotelId, businessDate: { gte: from, lte: to } },
      orderBy: { businessDate: "asc" },
    });
  },
  latestDailyIntelligence(hotelId: string) {
    return prisma.dailyIntelligenceReport.findFirst({ where: { hotelId }, orderBy: { businessDate: "desc" } });
  },
  revenueSourcesFor(nightAuditId: string) {
    return prisma.revenueSource.findMany({ where: { nightAuditId } });
  },

  // ── processing log (idempotency + observability) ──
  findLog(messageId: string, reportType: string) {
    return prisma.emailProcessingLog.findUnique({ where: { messageId_reportType: { messageId, reportType } } });
  },
  upsertLog(
    messageId: string,
    reportType: string,
    data: Omit<Prisma.EmailProcessingLogUncheckedCreateInput, "messageId" | "reportType" | "status"> & {
      status: EmailProcessingStatus;
    },
  ) {
    return prisma.emailProcessingLog.upsert({
      where: { messageId_reportType: { messageId, reportType } },
      create: { messageId, reportType, ...data },
      update: { ...data, attempt: { increment: 1 } },
    });
  },
  recentLogs(take = 25) {
    return prisma.emailProcessingLog.findMany({ orderBy: { createdAt: "desc" }, take });
  },
};
