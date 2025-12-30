import type { Role } from "../generated/prisma/client.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { id: string; email: string; role: Role };
  }
}

