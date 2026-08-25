import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import multipart from "@fastify/multipart";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { env, isOriginAllowed } from "./config.js";
import prismaPlugin from "./plugins/prisma.js";
import authPlugin from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { eventRoutes } from "./routes/events.js";
import { inventoryRoutes } from "./routes/inventory.js";
import { adminRoutes } from "./routes/admin.js";
import { streamRoutes } from "./routes/stream.js";
import { ZodError } from "zod";

declare module "fastify" {
  interface FastifyInstance {
    config: { storageDir: string };
  }
}

// trustProxy je nutné, aby request.ip byla adresa klienta a ne Render proxy.
// Bez toho by všichni uživatelé padali do jednoho společného rate-limit kbelíku
// a pár špatných pokusů kohokoli by odstřihlo celou firmu.
const app = Fastify({ logger: true, trustProxy: true });
const storageDir = path.isAbsolute(env.STORAGE_DIR)
  ? env.STORAGE_DIR
  : path.resolve(process.cwd(), env.STORAGE_DIR);
app.decorate("config", { storageDir });

app.addContentTypeParser("text/plain", { parseAs: "string" }, (req, body, done) => {
  done(null, body);
});

await app.register(cors, {
  // Requesty bez originu (curl, server-to-server, otevření PDF přes window.open)
  // nechávám projít, prohlížeč u nich origin neposílá. Cizí web se sem nedostane.
  // Neznámý origin nevyhazuje chybu, jen se mu nepošle Access-Control-Allow-Origin
  // a prohlížeč odpověď zahodí sám. Vyhozená chyba by z toho udělala 500,
  // což mate v logu a rozbíjí i vlastní kontrolu originu v /stream.
  origin: (origin, cb) => {
    if (!origin || isOriginAllowed(origin)) return cb(null, true);
    app.log.warn({ origin }, "CORS: zamítnutý origin");
    cb(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
});
// global: false — limit platí jen tam, kde si ho routa vyžádá přes config.rateLimit.
// Běžný provoz aplikace (načítání skladu, rezervace) brzdit nechceme.
await app.register(rateLimit, { global: false });
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
await app.register(prismaPlugin);
await app.register(authPlugin, { jwtSecret: env.JWT_SECRET });

app.setErrorHandler((err: unknown, request, reply) => {
  if (err instanceof ZodError) {
    return reply.status(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        details: err.issues
      }
    });
  }

  const statusCode =
    typeof (err as any)?.statusCode === "number" ? Number((err as any).statusCode) : 500;

  if (statusCode >= 400 && statusCode < 500) {
    const code = statusCode === 401 ? "UNAUTHENTICATED" : statusCode === 403 ? "FORBIDDEN" : "BAD_REQUEST";
    const message = err instanceof Error ? err.message : "Request failed";
    return reply.status(statusCode).send({ error: { code, message } });
  }

  request.log.error({ err }, "unhandled error");
  return reply.status(500).send({ error: { code: "INTERNAL", message: "Internal Server Error" } });
});

await mkdir(storageDir, { recursive: true });
await app.register(staticPlugin, { root: storageDir, prefix: "/storage/" });

await app.register(authRoutes);
await app.register(eventRoutes);
await app.register(inventoryRoutes);
await app.register(adminRoutes);
await app.register(streamRoutes);

app.get("/health", async () => {
  return { ok: true };
});

app.get("/meta/version", async () => {
  return { name: "@cater-sklad/api", version: "0.1.0", time: new Date().toISOString() };
});

app.listen({ port: env.PORT, host: "0.0.0.0" });
