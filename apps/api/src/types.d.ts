import "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    config: { storageDir: string };
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
