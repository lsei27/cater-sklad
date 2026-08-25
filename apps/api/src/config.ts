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
  STORAGE_DIR: z.string().default("storage"),
  BUNNY_STORAGE_ZONE: z.string().optional(),
  BUNNY_API_KEY: z.string().optional(),
  BUNNY_CDN_URL: z.string().optional(),
  // Čárkou oddělený seznam origins navíc. Slouží pro vlastní doménu, aby ji
  // šlo přidat bez zásahu do kódu. Produkční Vercel adresy jsou už v defaultu.
  CORS_ALLOWED_ORIGINS: z.string().optional()
});

const parsed = EnvSchema.parse(process.env);

// Produkční frontend běží na Vercelu pod třemi aliasy.
const PRODUCTION_ORIGINS = [
  "https://cater-sklad-web.vercel.app",
  "https://cater-sklad-web-lukass-projects-3750e58a.vercel.app",
  "https://cater-sklad-web-git-main-lukass-projects-3750e58a.vercel.app"
];

// Náhledové deploye mají v adrese pokaždé jiný hash, proto vzor místo výčtu.
const VERCEL_PREVIEW_ORIGIN = /^https:\/\/cater-sklad-[a-z0-9]+-lukass-projects-3750e58a\.vercel\.app$/;

// Localhost je v seznamu i na produkci. Podmínit to přes NODE_ENV nemá smysl,
// protože Render tu proměnnou vůbec nenastavuje, takže by podmínka nikdy nesepnula.
// Riziko je zanedbatelné: zneužít by to šlo jen ze stránky běžící na localhostu
// oběti, a kdo tam dokáže něco spustit, ten CORS řešit nepotřebuje.
const DEV_ORIGINS = ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000"];

const extraOrigins = (parsed.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const allowedOrigins = new Set([...PRODUCTION_ORIGINS, ...extraOrigins, ...DEV_ORIGINS]);

export function isOriginAllowed(origin: string) {
  if (allowedOrigins.has(origin)) return true;
  return VERCEL_PREVIEW_ORIGIN.test(origin);
}

export const env = {
  ...parsed,
  STORAGE_DIR: normalizeStorageDir(parsed.NODE_ENV, parsed.STORAGE_DIR)
};
