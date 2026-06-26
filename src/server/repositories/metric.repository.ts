import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/** Data-access for KPI snapshots, alerts and briefings (the CEO layer). */
export const metricRepository = {
  upsertSnapshot(
    hotelId: string,
    date: Date,
    data: Omit<Prisma.MetricSnapshotUncheckedCreateInput, "hotelId" | "date" | "source"> & {
      source?: string;
    },
  ) {
    const source = data.source ?? "stayflexi";
    return prisma.metricSnapshot.upsert({
      where: { hotelId_date_source: { hotelId, date, source } },
      create: { hotelId, date, source, ...data },
      update: { ...data },
    });
  },

  latestSnapshot(hotelId: string) {
    return prisma.metricSnapshot.findFirst({
      where: { hotelId },
      orderBy: { date: "desc" },
    });
  },

  snapshotsBetween(hotelId: string, from: Date, to: Date) {
    return prisma.metricSnapshot.findMany({
      where: { hotelId, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    });
  },

  // ── alerts ──
  raiseAlert(data: Prisma.AlertUncheckedCreateInput) {
    return prisma.alert.create({ data });
  },

  openAlerts(hotelId?: string, take = 20) {
    return prisma.alert.findMany({
      where: { acknowledged: false, ...(hotelId ? { hotelId } : {}) },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take,
    });
  },

  acknowledgeAlert(id: string) {
    return prisma.alert.update({
      where: { id },
      data: { acknowledged: true, resolvedAt: new Date() },
    });
  },

  // ── briefings ──
  upsertBriefing(
    hotelId: string,
    period: string,
    date: Date,
    data: Omit<Prisma.BriefingUncheckedCreateInput, "hotelId" | "period" | "date">,
  ) {
    return prisma.briefing.upsert({
      where: { hotelId_period_date: { hotelId, period, date } },
      create: { hotelId, period, date, ...data },
      update: { ...data },
    });
  },

  latestBriefing(hotelId: string, period: string) {
    return prisma.briefing.findFirst({
      where: { hotelId, period },
      orderBy: { date: "desc" },
    });
  },
};
