import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/** Data-access for the local Stayflexi booking projection (BookingCache). */
export const bookingRepository = {
  upsert(bookingId: string, data: Omit<Prisma.BookingCacheUncheckedCreateInput, "bookingId">) {
    return prisma.bookingCache.upsert({
      where: { bookingId },
      create: { bookingId, ...data },
      update: { ...data, lastSyncedAt: new Date() },
    });
  },

  /** Bookings whose stay overlaps [from, to). */
  inStayWindow(hotelId: string, from: Date, to: Date) {
    return prisma.bookingCache.findMany({
      where: {
        hotelId,
        status: { not: "CANCELLED" },
        checkin: { lt: to },
        checkout: { gt: from },
      },
    });
  },

  createdBetween(hotelId: string, from: Date, to: Date) {
    return prisma.bookingCache.findMany({
      where: { hotelId, createdAt: { gte: from, lt: to } },
    });
  },

  countByStatus(hotelId: string, from: Date, to: Date) {
    return prisma.bookingCache.groupBy({
      by: ["status"],
      where: { hotelId, createdAt: { gte: from, lt: to } },
      _count: { _all: true },
    });
  },
};
