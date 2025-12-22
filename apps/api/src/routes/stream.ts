import type { FastifyInstance } from "fastify";
import { sseBus } from "../lib/sse.js";

export async function streamRoutes(app: FastifyInstance) {
  app.get("/stream", async (request, reply) => {
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : "*";
    const token =
      // EventSource can't set headers reliably; allow query token for SSE.
      (request.query as any)?.token ??
      (typeof request.headers.authorization === "string" ? request.headers.authorization.split(" ")[1] : undefined);
    if (!token) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Missing token" } });
    try {
      const payload = app.jwt.verify<{ sub: string }>(token);
      const user = await app.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Invalid token" } });
      (request as any).user = { id: user.id, email: user.email, role: user.role };
    } catch {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Invalid token" } });
    }

    reply.raw.setHeader("Access-Control-Allow-Origin", origin);
    reply.raw.setHeader("Vary", "Origin");
    reply.raw.setHeader("Access-Control-Allow-Credentials", "true");
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders();

    const send = (data: any) => {
      reply.raw.write(`event: message\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send({ type: "connected", at: new Date().toISOString() });
    const off = sseBus.on((ev) => send(ev));

    request.raw.on("close", () => {
      off();
    });
  });
}
