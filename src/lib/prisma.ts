import { PrismaClient } from "@prisma/client";

/**
 * Singleton Prisma client. In dev, Next.js hot-reload would otherwise spawn a
 * new client (and a new connection pool) on every edit, exhausting Postgres
 * connections. Cache it on globalThis.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
