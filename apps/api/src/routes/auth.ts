import type { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { z } from "zod";
import { httpError } from "../lib/httpErrors.js";

const EmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(255)
  // allow internal emails like admin@local (no dot)
  .regex(/^[^\s@]+@[^\s@]+(\.[^\s@]+)?$/, "Invalid email");

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (request, reply) => {
    const body = z
      .object({
        email: EmailSchema,
        password: z.string().min(1)
      })
      .parse(request.body);

    const user = await app.prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return httpError(reply, 401, "INVALID_CREDENTIALS", "Invalid credentials");
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) return httpError(reply, 401, "INVALID_CREDENTIALS", "Invalid credentials");

    const token = app.jwt.sign({ sub: user.id }, { expiresIn: "12h" });
    return reply.send({ token, user: { id: user.id, email: user.email, role: user.role } });
  });
}
