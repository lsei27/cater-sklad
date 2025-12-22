import type { Role } from "@prisma/client";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { id: string; email: string; role: Role };
  }
}

