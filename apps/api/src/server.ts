import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import path from "node:path";
import { env } from "./config.js";
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

const app = Fastify({ logger: true });
app.decorate("config", { storageDir: env.STORAGE_DIR });

app.addContentTypeParser("text/plain", { parseAs: "string" }, (req, body, done) => {
  done(null, body);
});

await app.register(cors, { origin: true, credentials: true });
await app.register(prismaPlugin);
await app.register(authPlugin, { jwtSecret: env.JWT_SECRET });

app.setErrorHandler((err, request, reply) => {
  if (err instanceof ZodError) {
    return reply.status(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        details: err.issues
      }
    });
  }
  request.log.error({ err }, "unhandled error");
  return reply.status(500).send({ error: { code: "INTERNAL", message: "Internal Server Error" } });
});

const storageDir = path.resolve(process.cwd(), env.STORAGE_DIR);
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
