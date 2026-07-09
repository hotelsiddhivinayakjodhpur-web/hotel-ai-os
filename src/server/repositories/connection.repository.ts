import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/** Data access for connection metadata (never stores secrets). */
export const connectionRepository = {
  all() {
    return prisma.connectionState.findMany();
  },
  get(connectionId: string) {
    return prisma.connectionState.findUnique({ where: { connectionId } });
  },
  upsert(connectionId: string, data: Omit<Prisma.ConnectionStateUncheckedCreateInput, "connectionId">) {
    return prisma.connectionState.upsert({
      where: { connectionId },
      create: { connectionId, ...data },
      update: { ...data },
    });
  },
};
