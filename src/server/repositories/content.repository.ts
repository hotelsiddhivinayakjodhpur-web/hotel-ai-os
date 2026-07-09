import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/** Data access for Content AI drafts (ContentItem). */
export const contentRepository = {
  create(data: Prisma.ContentItemUncheckedCreateInput) {
    return prisma.contentItem.create({ data });
  },
  list(opts: { channel?: string; status?: string; take?: number } = {}) {
    return prisma.contentItem.findMany({
      where: {
        ...(opts.channel ? { channel: opts.channel } : {}),
        ...(opts.status ? { status: opts.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: opts.take ?? 50,
    });
  },
  scheduled(from: Date, to: Date) {
    return prisma.contentItem.findMany({
      where: { scheduledFor: { gte: from, lte: to }, status: { not: "ARCHIVED" } },
      orderBy: { scheduledFor: "asc" },
    });
  },
  setStatus(id: string, status: string) {
    return prisma.contentItem.update({ where: { id }, data: { status } });
  },
  setSchedule(id: string, scheduledFor: Date | null) {
    return prisma.contentItem.update({ where: { id }, data: { scheduledFor } });
  },
  countByChannel() {
    return prisma.contentItem.groupBy({ by: ["channel"], _count: { _all: true } });
  },
  countByStatus() {
    return prisma.contentItem.groupBy({ by: ["status"], _count: { _all: true } });
  },
};
