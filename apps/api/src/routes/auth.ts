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

// Limit je schválně velkorysý: běžný uživatel, který si dvakrát přehmátne heslo,
// na něj nesmí narazit. Proti hádání hesel hrubou silou stačí i takhle nastavený.
const LOGIN_RATE_LIMIT = {
  rateLimit: {
    max: 10,
    timeWindow: "5 minutes",
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: { code: "TOO_MANY_REQUESTS", message: "Příliš mnoho pokusů. Zkus to znovu za pár minut." }
    })
  }
};

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", { config: LOGIN_RATE_LIMIT }, async (request, reply) => {
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

  app.post("/auth/change-password", { config: LOGIN_RATE_LIMIT, preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    const body = z
      .object({
        oldPassword: z.string().min(1),
        newPassword: z.string().min(6)
      })
      .parse(request.body);

    const dbUser = await app.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) return httpError(reply, 404, "NOT_FOUND", "User not found");

    const match = await bcrypt.compare(body.oldPassword, dbUser.passwordHash);
    if (!match) return httpError(reply, 401, "INVALID_CREDENTIALS", "Špatné současné heslo");

    const hash = await bcrypt.hash(body.newPassword, 10);
    await app.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash }
    });

    await app.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        entityType: "user",
        entityId: user.id,
        action: "change_password"
      }
    });

    return reply.send({ ok: true });
  });
}
