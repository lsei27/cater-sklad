import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

/**
 * Prisma 7 už nepřijímá `datasources` v konstruktoru a vyžaduje driver adapter,
 * stejně jako produkční plugin v src/plugins/prisma.ts.
 */
export function createTestPrisma(url: string) {
  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    prisma,
    async disconnect() {
      await prisma.$disconnect();
      await pool.end();
    }
  };
}
