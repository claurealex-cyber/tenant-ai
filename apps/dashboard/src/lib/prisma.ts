import { PrismaClient } from "@prisma/client";
import { initConfigResolver } from "@tenant-ai/shared";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Initialize the shared config resolver so resolveConfig/resolveIntegration
// can read encrypted values from the SystemConfig table.
initConfigResolver({
  async get(key: string) {
    const row = await prisma.systemConfig.findUnique({ where: { key } });
    return row?.value ?? null;
  },
});
