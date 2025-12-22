import "fastify";
import type { Role } from "@prisma/client";

declare module "fastify" {
  interface FastifyInstance {
    config: { storageDir: string };
    authenticate: (request: any, reply: any) => Promise<void>;
  }

  interface FastifyRequest {
    user?: { id: string; email: string; role: Role };
  }
}

