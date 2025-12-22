import type { FastifyReply } from "fastify";

export function httpError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>
) {
  return reply.status(statusCode).send({ error: { code, message, ...extra } });
}

