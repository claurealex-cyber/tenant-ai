import { prisma } from "./prisma";
import type { ConfigStore } from "@tenant-ai/shared";

export const prismaConfigStore: ConfigStore = {
  async get(key: string): Promise<string | null> {
    const row = await prisma.systemConfig.findUnique({ where: { key } });
    return row?.value ?? null;
  },
};
