import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";

dotenv.config();

function normalizeStorageDir(nodeEnv: string, storageDir: string) {
  if (nodeEnv === "production" && !path.isAbsolute(storageDir)) return "/tmp/cater-sklad-storage";
  return storageDir;
}

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  STORAGE_DIR: z.string().default("storage")
});

const parsed = EnvSchema.parse(process.env);
export const env = {
  ...parsed,
  STORAGE_DIR: normalizeStorageDir(parsed.NODE_ENV, parsed.STORAGE_DIR)
};
