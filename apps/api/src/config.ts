import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const storageDefault =
  (process.env.NODE_ENV ?? "development") === "production"
    ? "/tmp/cater-sklad-storage"
    : "storage";

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  STORAGE_DIR: z.string().default(storageDefault)
});

export const env = EnvSchema.parse(process.env);
