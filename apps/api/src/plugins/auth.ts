import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { Role, User } from "@prisma/client";

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string; email: string; role: Role };
  }
}

export default fp(async (app, opts: { jwtSecret: string }) => {
  await app.register(jwt, { secret: opts.jwtSecret });

  app.decorate("authenticate", async (request: any, reply: any) => {
    try {
      const payload = await request.jwtVerify<{ sub: string }>();
      const user = await app.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Invalid token" } });
      request.user = { id: user.id, email: user.email, role: user.role };
    } catch {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Invalid token" } });
    }
  });
});

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
  }
}

